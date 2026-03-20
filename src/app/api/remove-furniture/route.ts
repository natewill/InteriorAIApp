import assert from 'node:assert/strict'
import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import sharp from 'sharp'
import { getRemoveFurniturePrompt } from '@/prompts/removeFurniture'

type RemoveFurnitureRequest = {
    roomImageUrl: string
    maskUrl: string
    numImages: number
}

type RemoveFurnitureSuccessResponse = {
    kind: 'ok'
    images: Array<{ url: string }>
}

type RemoveFurnitureErrorResponse = {
    kind: 'error'
    error: string
}

const CHECKER_SIZE = 16
const MAX_IMAGES = 6

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')
const model = genAI.getGenerativeModel({
    model: 'gemini-3-pro-image-preview',
    generationConfig: {
        responseModalities: ['Text', 'Image'],
    } as any,
})

function parseRequest(raw: unknown): RemoveFurnitureRequest {
    assert(raw && typeof raw === 'object', 'Request body must be an object')
    const body = raw as Record<string, unknown>

    assert(typeof body.roomImageUrl === 'string' && body.roomImageUrl.length > 0, 'roomImageUrl is required')
    assert(typeof body.maskUrl === 'string' && body.maskUrl.length > 0, 'maskUrl is required')

    const numImages = typeof body.numImages === 'number' ? body.numImages : 3

    return {
        roomImageUrl: body.roomImageUrl,
        maskUrl: body.maskUrl,
        numImages: Math.max(1, Math.min(MAX_IMAGES, Math.floor(numImages))),
    }
}

function parseDataUrl(dataUrl: string): Buffer {
    const match = dataUrl.match(/^data:[^;]+;base64,(.+)$/)
    assert(match, 'Invalid data URL')
    return Buffer.from(match[1], 'base64')
}

async function loadImageBuffer(source: string): Promise<Buffer> {
    if (source.startsWith('data:')) return parseDataUrl(source)

    const response = await fetch(source)
    if (!response.ok) throw new Error(`Failed to load image: ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
}

async function cutFurnitureFromRoom(roomBuffer: Buffer, maskBuffer: Buffer): Promise<Buffer> {
    const roomMeta = await sharp(roomBuffer).metadata()
    const width = roomMeta.width || 1
    const height = roomMeta.height || 1

    const roomRgba = await sharp(roomBuffer).ensureAlpha().raw().toBuffer()
    const maskRgba = await sharp(maskBuffer)
        .resize(width, height, { fit: 'fill' })
        .ensureAlpha()
        .raw()
        .toBuffer()

    const output = Buffer.alloc(roomRgba.length)

    for (let i = 0; i < width * height; i += 1) {
        const offset = i * 4
        const maskAlpha = maskRgba[offset + 3]
        const maskRed = maskRgba[offset]
        const isRemovePixel = maskAlpha > 50 && maskRed > 50

        if (!isRemovePixel) {
            output[offset] = roomRgba[offset]
            output[offset + 1] = roomRgba[offset + 1]
            output[offset + 2] = roomRgba[offset + 2]
            output[offset + 3] = roomRgba[offset + 3]
            continue
        }

        const x = i % width
        const y = Math.floor(i / width)
        const isEvenSquare = (Math.floor(x / CHECKER_SIZE) + Math.floor(y / CHECKER_SIZE)) % 2 === 0

        output[offset] = isEvenSquare ? 255 : 0
        output[offset + 1] = 255
        output[offset + 2] = 255
        output[offset + 3] = 255

        if (isEvenSquare) output[offset + 1] = 0
    }

    return sharp(output, {
        raw: {
            width,
            height,
            channels: 4,
        },
    }).png().toBuffer()
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
        const roomBuffer = await loadImageBuffer(input.roomImageUrl)
        const maskBuffer = await loadImageBuffer(input.maskUrl)
        const roomWithHole = await cutFurnitureFromRoom(roomBuffer, maskBuffer)
        const roomWithHoleBase64 = roomWithHole.toString('base64')
        const prompt = getRemoveFurniturePrompt()

        const images = await Promise.all(
            Array.from({ length: input.numImages }, async () => {
                const result = await model.generateContent([
                    {
                        inlineData: {
                            mimeType: 'image/png',
                            data: roomWithHoleBase64,
                        },
                    },
                    { text: prompt },
                ])

                return { url: extractImageDataUrl(result.response) }
            }),
        )

        const payload: RemoveFurnitureSuccessResponse = { kind: 'ok', images }
        return NextResponse.json(payload)
    } catch (error) {
        const payload: RemoveFurnitureErrorResponse = {
            kind: 'error',
            error: error instanceof Error ? error.message : 'Furniture removal failed',
        }
        return NextResponse.json(payload, { status: 500 })
    }
}
