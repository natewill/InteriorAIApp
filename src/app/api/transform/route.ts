import assert from 'node:assert/strict'
import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import sharp from 'sharp'

type LightingMode = 'daytime' | 'nighttime'

type TransformRequest = {
    roomImageUrl: string
    referenceImageUrl: string
    roomType: string
    lightingMode: LightingMode
    transformationAmount: number
    numImages: number
}

type TransformSuccessResponse = {
    kind: 'ok'
    images: Array<{ url: string }>
}

type TransformErrorResponse = {
    kind: 'error'
    error: string
}

const MAX_DIMENSION = 3072
const TARGET_LONG_EDGE = 1024
const MAX_IMAGES = 6

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')
const model = genAI.getGenerativeModel({
    model: 'gemini-3-pro-image-preview',
    generationConfig: {
        responseModalities: ['Text', 'Image'],
        imageConfig: { imageSize: '1K' } as any,
    } as any,
})

const LIGHTING_PROMPTS: Record<LightingMode, string> = {
    daytime:
        'Use bright natural daylight from existing windows. Keep realistic shadows and preserve original window positions.',
    nighttime:
        'Use warm indoor night lighting. Keep windows dark outside and preserve original window positions.',
}

function parseRequest(raw: unknown): TransformRequest {
    assert(raw && typeof raw === 'object', 'Request body must be an object')
    const body = raw as Record<string, unknown>

    assert(typeof body.roomImageUrl === 'string' && body.roomImageUrl.length > 0, 'roomImageUrl is required')
    assert(typeof body.referenceImageUrl === 'string' && body.referenceImageUrl.length > 0, 'referenceImageUrl is required')

    const roomType = typeof body.roomType === 'string' && body.roomType.trim() ? body.roomType.trim() : 'room'
    const lightingMode: LightingMode = body.lightingMode === 'nighttime' ? 'nighttime' : 'daytime'
    const transformationAmount = typeof body.transformationAmount === 'number' ? body.transformationAmount : 0.6
    const numImages = typeof body.numImages === 'number' ? body.numImages : 2

    return {
        roomImageUrl: body.roomImageUrl,
        referenceImageUrl: body.referenceImageUrl,
        roomType,
        lightingMode,
        transformationAmount: Math.max(0, Math.min(1, transformationAmount)),
        numImages: Math.max(1, Math.min(MAX_IMAGES, Math.floor(numImages))),
    }
}

function buildPrompt(roomType: string, lightingMode: LightingMode, amount: number): string {
    const percent = Math.round(amount * 100)
    const intensityText = amount < 0.34
        ? 'Make subtle furniture and decor updates while keeping most existing pieces.'
        : amount < 0.67
            ? 'Restyle about half the furniture and decor while keeping the room recognizable.'
            : 'Fully restyle the furniture and decor while preserving architecture and camera view.'

    return `
Edit image 1 as a ${roomType}.

This is an edit, not a new render.
Keep architecture fixed: walls, windows, doors, floor, and ceiling must stay unchanged.
Keep camera angle and perspective unchanged.
Only change furniture and movable decor.

Transformation amount: ${percent}%.
${intensityText}

Style target:
- Match furniture style, color palette, and materials from image 2.
- Do not copy image 2 layout.
- Keep arrangement practical for image 1 room dimensions.
- Make lighting and shadows photorealistic.

Lighting:
- ${LIGHTING_PROMPTS[lightingMode]}
`.trim()
}

function parseDataUrl(dataUrl: string): { buffer: Buffer; mimeType: string } {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
    assert(match, 'Invalid data URL')
    return {
        mimeType: match[1],
        buffer: Buffer.from(match[2], 'base64'),
    }
}

async function loadImage(source: string): Promise<{ buffer: Buffer; mimeType: string }> {
    if (source.startsWith('data:')) return parseDataUrl(source)
    const response = await fetch(source)
    if (!response.ok) throw new Error(`Failed to load image: ${response.status}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    const mimeType = response.headers.get('content-type') || 'image/png'
    return { buffer, mimeType }
}

type PreparedImage = {
    mimeType: string
    base64: string
    aspectRatio: number
}

async function prepareImage(source: string, targetAspectRatio: number | null): Promise<PreparedImage> {
    const { buffer } = await loadImage(source)
    const metadata = await sharp(buffer).metadata()
    const width = metadata.width || 1
    const height = metadata.height || 1
    const aspectRatio = width / height

    const scale = Math.min(1, TARGET_LONG_EDGE / Math.max(width, height), MAX_DIMENSION / width, MAX_DIMENSION / height)
    const resizedWidth = Math.max(1, Math.round(width * scale))
    const resizedHeight = Math.max(1, Math.round(height * scale))

    let pipeline = sharp(buffer).resize(resizedWidth, resizedHeight, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 },
    })

    if (targetAspectRatio) {
        const longEdge = Math.max(resizedWidth, resizedHeight)
        const targetWidth = targetAspectRatio >= 1 ? longEdge : Math.round(longEdge * targetAspectRatio)
        const targetHeight = targetAspectRatio >= 1 ? Math.round(longEdge / targetAspectRatio) : longEdge
        pipeline = pipeline.resize(targetWidth, targetHeight, {
            fit: 'contain',
            background: { r: 255, g: 255, b: 255, alpha: 1 },
        })
    }

    const output = await pipeline.jpeg({ quality: 80 }).toBuffer()
    return {
        mimeType: 'image/jpeg',
        base64: output.toString('base64'),
        aspectRatio: targetAspectRatio || aspectRatio,
    }
}

function extractImageDataUrl(response: Awaited<ReturnType<typeof model.generateContent>>['response']): string {
    const candidate = response.candidates?.[0]
    assert(candidate?.content?.parts, 'Gemini returned no candidates')

    for (const part of candidate.content.parts) {
        if ('inlineData' in part && part.inlineData?.data) {
            const mimeType = part.inlineData.mimeType || 'image/png'
            return `data:${mimeType};base64,${part.inlineData.data}`
        }
    }

    throw new Error('Gemini returned no image')
}

export async function POST(request: NextRequest) {
    try {
        const input = parseRequest(await request.json())
        const prompt = buildPrompt(input.roomType, input.lightingMode, input.transformationAmount)

        const roomImage = await prepareImage(input.roomImageUrl, null)
        const referenceImage = await prepareImage(input.referenceImageUrl, roomImage.aspectRatio)

        const images = await Promise.all(
            Array.from({ length: input.numImages }, async () => {
                const result = await model.generateContent([
                    prompt,
                    {
                        inlineData: {
                            mimeType: roomImage.mimeType,
                            data: roomImage.base64,
                        },
                    },
                    {
                        inlineData: {
                            mimeType: referenceImage.mimeType,
                            data: referenceImage.base64,
                        },
                    },
                ])

                return { url: extractImageDataUrl(result.response) }
            }),
        )

        const payload: TransformSuccessResponse = { kind: 'ok', images }
        return NextResponse.json(payload)
    } catch (error) {
        const payload: TransformErrorResponse = {
            kind: 'error',
            error: error instanceof Error ? error.message : 'Transform failed',
        }
        return NextResponse.json(payload, { status: 500 })
    }
}
