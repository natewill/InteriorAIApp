import { NextResponse } from 'next/server'
import {
    buildServerlessUrl,
    fetchWithRetry,
    getRunpodApiKey,
    resolveSam3Target,
    waitForServerlessOutput,
} from '../runpod'

// Fire-and-forget warmup for Modal serverless endpoints.
// Wakes SAM3 tracker + Depth Anything containers in parallel so they're
// ready when the user actually needs segmentation or depth estimation.

const MODAL_DEPTH_URL = process.env.MODAL_DEPTH_URL?.trim()

async function warmSam3(): Promise<{ service: string; ok: boolean; output?: unknown; reason?: string }> {
    const target = resolveSam3Target()
    if (!target) {
        return { service: 'sam3', ok: false, reason: 'no_endpoint' }
    }

    try {
        if (target.serverless) {
            const apiKey = getRunpodApiKey()
            const targetUrl = buildServerlessUrl(target.url)
            const headers: Record<string, string> = { 'Content-Type': 'application/json' }
            if (apiKey) headers.Authorization = `Bearer ${apiKey}`

            const res = await fetchWithRetry(targetUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify({ input: { action: 'warmup' } }),
            }, 'sam3 warmup')

            if (!res.ok) {
                const errText = await res.text()
                console.warn('[SAM3] warmup failed:', errText)
                return { service: 'sam3', ok: false, reason: errText }
            }

            const raw = await res.json()
            const output = await waitForServerlessOutput(raw, targetUrl, headers)
            console.log('[SAM3] warmup complete:', output)
            return { service: 'sam3', ok: true, output }
        } else {
            const res = await fetch(`${target.url}/runsync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ input: { action: 'warmup' } }),
            })

            if (!res.ok) {
                const errText = await res.text()
                console.warn('[SAM3] warmup failed:', errText)
                return { service: 'sam3', ok: false, reason: errText }
            }

            const data = await res.json()
            console.log('[SAM3] warmup complete:', data)
            return { service: 'sam3', ok: true, output: data }
        }
    } catch (error: unknown) {
        console.warn('[SAM3] warmup error:', error)
        return { service: 'sam3', ok: false, reason: error instanceof Error ? error.message : 'warmup failed' }
    }
}

async function warmDepth(): Promise<{ service: string; ok: boolean; output?: unknown; reason?: string }> {
    if (!MODAL_DEPTH_URL) {
        return { service: 'depth', ok: false, reason: 'no_endpoint' }
    }

    try {
        const res = await fetch(MODAL_DEPTH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input: { action: 'warmup' } }),
        })

        if (!res.ok) {
            const errText = await res.text()
            console.warn('[Depth] warmup failed:', errText)
            return { service: 'depth', ok: false, reason: errText }
        }

        const raw = await res.json()
        const output = raw?.output ?? raw
        console.log('[Depth] warmup complete:', output)
        return { service: 'depth', ok: true, output }
    } catch (error: unknown) {
        console.warn('[Depth] warmup error:', error)
        return { service: 'depth', ok: false, reason: error instanceof Error ? error.message : 'warmup failed' }
    }
}

export async function POST() {
    const results = await Promise.allSettled([warmSam3(), warmDepth()])

    const sam3 = results[0].status === 'fulfilled' ? results[0].value : { service: 'sam3', ok: false, reason: 'unexpected' }
    const depth = results[1].status === 'fulfilled' ? results[1].value : { service: 'depth', ok: false, reason: 'unexpected' }

    return NextResponse.json({ sam3, depth })
}
