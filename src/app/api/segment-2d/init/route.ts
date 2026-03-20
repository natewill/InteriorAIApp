import { NextRequest, NextResponse } from 'next/server'
import {
    buildServerlessUrl,
    fetchWithRetry,
    getRunpodApiKey,
    resolveSam3Target,
    waitForServerlessOutput,
} from '../runpod'

// Pre-encode image on upload so the first click is instant.
// Returns imageId which the frontend passes to /api/segment-2d for decode.

export async function POST(request: NextRequest) {
    const target = resolveSam3Target()
    if (!target) {
        return NextResponse.json(
            { error: 'SAM3 endpoint not configured' },
            { status: 500 }
        )
    }

    try {
        const formData = await request.formData()
        const imageFile = formData.get('image') as File | null

        if (!imageFile) {
            return NextResponse.json({ error: 'Image file is required' }, { status: 400 })
        }

        console.log(`[SAM3] Pre-encoding image (${imageFile.size} bytes) using ${target.serverless ? 'serverless' : 'direct'} endpoint...`)

        let data: {
            image_id: string
            original_size: [number, number]
            input_size: [number, number]
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

            const imageBytes = Buffer.from(await imageFile.arrayBuffer())
            const imageB64 = imageBytes.toString('base64')

            const res = await fetchWithRetry(targetUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    input: {
                        action: 'segment_init',
                        image: imageB64,
                        max_side: 1024,
                    },
                }),
            }, 'segment_init runsync')

            if (!res.ok) {
                const errText = await res.text()
                console.error('[SAM3] runsync segment_init failed:', errText)
                return NextResponse.json({ error: `SAM3 init failed: ${errText}` }, { status: 500 })
            }

            const raw = await res.json()
            data = await waitForServerlessOutput(raw, targetUrl, headers) as typeof data
        } else {
            const form = new FormData()
            form.append('image', imageFile, 'image.png')
            form.append('max_side', '1024')

            const res = await fetch(`${target.url}/segment/init_form`, {
                method: 'POST',
                body: form,
            })

            if (!res.ok) {
                const errText = await res.text()
                console.error('[SAM3] /segment/init_form failed:', errText)
                return NextResponse.json({ error: `SAM3 init failed: ${errText}` }, { status: 500 })
            }

            data = await res.json() as typeof data
        }

        console.log(`[SAM3] Pre-encoded → image_id=${data.image_id}, size=${data.original_size}`)

        return NextResponse.json({
            imageId: data.image_id,
            originalSize: data.original_size,
        })
    } catch (error: unknown) {
        console.error('Segment init error:', error)
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Segment init failed' },
            { status: 500 }
        )
    }
}
