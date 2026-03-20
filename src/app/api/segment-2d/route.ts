import { NextRequest, NextResponse } from 'next/server'
import {
    buildServerlessUrl,
    fetchWithRetry,
    getRunpodApiKey,
    resolveSam3Target,
    waitForServerlessOutput,
} from './runpod'

// Decode mask from a pre-encoded image.
// Expects JSON: { imageId, points }
// Returns raw PNG mask bytes.

interface SegmentPoint {
    x: number
    y: number
    label: number
}

export async function POST(request: NextRequest) {
    const target = resolveSam3Target()
    if (!target) {
        return NextResponse.json(
            { error: 'SAM3 endpoint not configured' },
            { status: 500 }
        )
    }

    try {
        const { imageId, points } = await request.json() as {
            imageId: string
            points: SegmentPoint[]
        }

        if (!imageId) {
            return NextResponse.json({ error: 'imageId is required' }, { status: 400 })
        }
        if (!points || points.length === 0) {
            return NextResponse.json({ error: 'At least one point is required' }, { status: 400 })
        }

        console.log(`[SAM3] Decode: imageId=${imageId}, ${points.length} points (${target.serverless ? 'serverless' : 'direct'})`)

        const decodePayload = {
            image_id: imageId,
            points: points.map(p => [Math.round(p.x), Math.round(p.y)]),
            labels: points.map(p => (p.label === 1 ? 1 : 0)),
            include_mask_base64: true,
            return_polygons: false,
        }

        let data: {
            masks: (string | null)[]
            scores: number[]
            decode_ms: number
        }

        if (target.serverless) {
            const apiKey = getRunpodApiKey()
            if (target.requiresAuth && !apiKey) {
                return NextResponse.json(
                    { error: 'RUNPOD_API_KEY is required when using a RunPod serverless URL' },
                    { status: 500 }
                )
            }

            const targetUrl = buildServerlessUrl(target.url)
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
            }
            if (apiKey) headers.Authorization = `Bearer ${apiKey}`

            const res = await fetchWithRetry(targetUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    input: {
                        action: 'segment_decode',
                        ...decodePayload,
                    },
                }),
            }, 'segment_decode runsync')

            if (!res.ok) {
                const errText = await res.text()
                console.error('[SAM3] runsync segment_decode failed:', errText)
                return NextResponse.json(
                    { error: `SAM3 decode failed: ${errText}` },
                    { status: errText.includes('not found') ? 410 : 500 }
                )
            }

            const raw = await res.json()
            data = await waitForServerlessOutput(raw, targetUrl, headers) as typeof data
        } else {
            const res = await fetch(`${target.url}/segment/decode`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(decodePayload),
            })

            if (!res.ok) {
                const errText = await res.text()
                console.error('[SAM3] /segment/decode failed:', errText)
                return NextResponse.json(
                    { error: `SAM3 decode failed: ${errText}` },
                    { status: errText.includes('not found') ? 410 : 500 }
                )
            }

            data = await res.json() as typeof data
        }

        console.log(`[SAM3] Decode: ${data.masks?.length} masks, scores=${data.scores}, ${data.decode_ms?.toFixed(0)}ms`)

        const bestMask = data.masks?.[0]
        if (!bestMask) {
            return NextResponse.json({ error: 'SAM3 did not return a mask' }, { status: 500 })
        }

        const maskBuffer = Buffer.from(bestMask, 'base64')

        return new NextResponse(maskBuffer, {
            status: 200,
            headers: { 'Content-Type': 'image/png' },
        })
    } catch (error: unknown) {
        console.error('2D segmentation error:', error)
        return NextResponse.json(
            { error: error instanceof Error ? error.message : '2D segmentation failed' },
            { status: 500 }
        )
    }
}
