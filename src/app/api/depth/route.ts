import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'

const MODAL_DEPTH_URL = process.env.MODAL_DEPTH_URL?.trim()

if (!MODAL_DEPTH_URL) {
    console.warn('MODAL_DEPTH_URL not set — depth API will fail')
}

// DA3 internally processes at ~504px, so sending anything larger is wasted bandwidth.
// We resize to 1024px max side: sharp enough for depth quality, small enough for fast transfer.
const MAX_SIDE = 1024

export async function POST(request: NextRequest) {
    try {
        const { imageUrl } = await request.json() as { imageUrl: string }

        if (!imageUrl) {
            return NextResponse.json({ error: 'imageUrl is required' }, { status: 400 })
        }

        if (!MODAL_DEPTH_URL) {
            return NextResponse.json({ error: 'MODAL_DEPTH_URL not configured' }, { status: 500 })
        }

        // Strip data URL prefix → raw base64
        const rawBase64 = imageUrl.startsWith('data:') ? imageUrl.split(',')[1] : imageUrl

        // Resize before sending to Modal
        const inputBuffer = Buffer.from(rawBase64, 'base64')
        const resized = await sharp(inputBuffer)
            .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 85 })
            .toBuffer()

        const base64Image = resized.toString('base64')
        const originalKB = (inputBuffer.length / 1024).toFixed(0)
        const resizedKB = (resized.length / 1024).toFixed(0)
        console.log(`Calling Depth Anything 3... (${originalKB}KB → ${resizedKB}KB)`)

        // Modal runsync is synchronous — returns immediately with the result
        const response = await fetch(MODAL_DEPTH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input: { action: 'depth', image: base64Image } }),
        })

        if (!response.ok) {
            const text = await response.text()
            console.error('Depth endpoint error:', text)
            throw new Error(`Depth request failed: ${response.status}`)
        }

        const raw = await response.json()
        const data = raw?.output ?? raw

        if (data.error) {
            return NextResponse.json({ error: data.error }, { status: 502 })
        }

        if (!data.depth_map) {
            return NextResponse.json({ error: 'Depth estimation did not return an image.' }, { status: 500 })
        }

        return NextResponse.json({
            depthImageUrl: `data:image/png;base64,${data.depth_map}`,
            width: data.width,
            height: data.height,
        })
    } catch (error: unknown) {
        console.error('Depth estimation error:', error)
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Depth estimation failed' },
            { status: 500 }
        )
    }
}
