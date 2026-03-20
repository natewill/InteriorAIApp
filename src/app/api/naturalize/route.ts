import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import sharp from 'sharp'
import { getNaturalizePrompt } from '@/prompts/naturalize'

const genAI = new GoogleGenerativeAI((process.env.GEMINI_API_KEY || '').trim())
const PRIMARY_MODEL = 'gemini-3.1-flash-image-preview'
const FALLBACK_MODEL = 'gemini-3-pro-image-preview'

const MAX_DIMENSION = 3072
const TARGET_LONG_EDGE = 1024

interface NaturalizeRequest {
    compositeImageUrl: string       // Room with furniture overlaid (base64 data URL)
    maskImageUrl?: string           // Binary mask (white = furniture, black = background)
    furnitureType: string           // "chair", "desk", etc.
    numberOfImages: number          // How many variations to generate
    referenceImageUrl?: string      // Original furniture photo (before 3D conversion)
    furnitureMaskUrl?: string       // Segmentation mask from SAM3
}

type LoadedImage = {
    buffer: Buffer
    mimeType: string
}

type PreparedImage = {
    mimeType: string
    data: string
    width: number
    height: number
    aspectRatio: number
}

function parseDataUrl(dataUrl: string): LoadedImage {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
    if (!match) {
        throw new Error('Invalid image data URL format')
    }

    return {
        mimeType: match[1],
        buffer: Buffer.from(match[2], 'base64'),
    }
}

async function loadImage(source: string): Promise<LoadedImage> {
    if (source.startsWith('data:')) {
        return parseDataUrl(source)
    }

    const response = await fetch(source)
    if (!response.ok) {
        throw new Error(`Failed to load image: ${response.status}`)
    }

    return {
        buffer: Buffer.from(await response.arrayBuffer()),
        mimeType: response.headers.get('content-type') || 'image/png',
    }
}

async function preparePhoto(source: string, targetAspectRatio: number | null): Promise<PreparedImage> {
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
    const outputMeta = await sharp(output).metadata()

    return {
        mimeType: 'image/jpeg',
        data: output.toString('base64'),
        width: outputMeta.width || resizedWidth,
        height: outputMeta.height || resizedHeight,
        aspectRatio: targetAspectRatio || aspectRatio,
    }
}

async function prepareMask(source: string, width: number, height: number): Promise<PreparedImage> {
    const { buffer } = await loadImage(source)
    const output = await sharp(buffer)
        .resize(width, height, { fit: 'fill' })
        .png()
        .toBuffer()

    return {
        mimeType: 'image/png',
        data: output.toString('base64'),
        width,
        height,
        aspectRatio: width / height,
    }
}

function extractImageDataUrl(response: any): string {
    const candidate = response.candidates?.[0]

    if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
            if ('inlineData' in part && part.inlineData?.data) {
                const mimeType = part.inlineData.mimeType || 'image/png'
                return `data:${mimeType};base64,${part.inlineData.data}`
            }
        }
    }

    const text = response.text()
    if (text) {
        throw new Error(`Gemini returned no image: ${text}`)
    }

    throw new Error('Gemini returned no image')
}

function isValidImageUrl(value: string): boolean {
    return value.startsWith('data:image/') || value.startsWith('https://');
}

function normalizeNaturalizeError(message: string): string {
    const normalized = message.toLowerCase()

    if (
        normalized.includes('the string did not match the expected pattern') ||
        normalized.includes('unable to process input image') ||
        normalized.includes('fetch failed')
    ) {
        return 'Image generation failed for this scene. Please adjust placement or retry.'
    }

    if (
        normalized.includes('unregistered callers') ||
        normalized.includes('api key')
    ) {
        return 'Image generation is unavailable right now. Please check server API key configuration.'
    }

    return message
}

function createModel(modelName: string) {
    return genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
            responseModalities: ['Text', 'Image'],
        } as any,
    })
}

async function generateImagesWithModel(promptParts: any[], numImages: number, modelName: string): Promise<Array<{ url: string }>> {
    const model = createModel(modelName)

    const generationPromises = Array.from({ length: numImages }, async () => {
        const result = await model.generateContent(promptParts)
        return { url: extractImageDataUrl(result.response) }
    })

    const settled = await Promise.allSettled(generationPromises)
    const images: Array<{ url: string }> = []

    for (const result of settled) {
        if (result.status !== 'fulfilled') {
            continue
        }
        if (!isValidImageUrl(result.value.url)) {
            continue
        }
        images.push(result.value)
    }

    return images
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json() as NaturalizeRequest
        const { compositeImageUrl, furnitureType, maskImageUrl, numberOfImages, referenceImageUrl, furnitureMaskUrl } = body

        if (!compositeImageUrl) {
            return NextResponse.json(
                { error: 'Composite image URL is required' },
                { status: 400 }
            )
        }

        if (!furnitureType) {
            return NextResponse.json(
                { error: 'Furniture type is required' },
                { status: 400 }
            )
        }

        const numImages = Math.max(1, Math.min(numberOfImages || 3, 6))
        const compositeImage = await preparePhoto(compositeImageUrl, null)

        // Prepare prompt parts: composite image + optional mask + text prompt
        const promptParts: any[] = [
            {
                inlineData: {
                    mimeType: compositeImage.mimeType,
                    data: compositeImage.data,
                },
            }
        ]

        // Add mask if available
        if (maskImageUrl) {
            const maskImage = await prepareMask(maskImageUrl, compositeImage.width, compositeImage.height)
            promptParts.push({
                inlineData: {
                    mimeType: maskImage.mimeType,
                    data: maskImage.data,
                },
            })
        }

        // Add original furniture reference photo so Gemini can see true texture/material
        if (referenceImageUrl) {
            const referenceImage = await preparePhoto(referenceImageUrl, compositeImage.aspectRatio)
            promptParts.push({
                inlineData: {
                    mimeType: referenceImage.mimeType,
                    data: referenceImage.data,
                },
            })

            if (furnitureMaskUrl) {
                const furnitureMaskImage = await prepareMask(furnitureMaskUrl, referenceImage.width, referenceImage.height)
                promptParts.push({
                    inlineData: {
                        mimeType: furnitureMaskImage.mimeType,
                        data: furnitureMaskImage.data,
                    },
                })
            }
        }

        const promptText = getNaturalizePrompt(furnitureType)
        promptParts.push({ text: promptText })

        console.log(`Calling Gemini for naturalization (${numImages} images in parallel, model=${PRIMARY_MODEL})...`)

        let images = await generateImagesWithModel(promptParts, numImages, PRIMARY_MODEL)
        if (images.length === 0) {
            try {
                images = await generateImagesWithModel(promptParts, Math.min(numImages, 2), FALLBACK_MODEL)
                if (images.length > 0) {
                    console.log(`Naturalize recovered via fallback model=${FALLBACK_MODEL}`)
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                console.error('Naturalize fallback failed:', message)

                if (normalizeNaturalizeError(message) === message) {
                    throw error
                }
            }
        }

        if (images.length === 0) {
            return NextResponse.json(
                { error: 'Image generation failed for this scene. Please adjust placement or retry.' },
                { status: 500 }
            )
        }

        console.log(`Generated ${images.length} naturalized image(s)`)

        return NextResponse.json({ images })
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('Naturalization error:', message)
        const safeMessage = normalizeNaturalizeError(message)

        return NextResponse.json(
            { error: safeMessage || 'Naturalization failed' },
            { status: 500 }
        )
    }
}
