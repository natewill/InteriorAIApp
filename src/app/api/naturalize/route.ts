import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { getNaturalizePrompt } from '@/prompts/naturalize'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')

interface NaturalizeRequest {
    compositeImageUrl: string       // Room with furniture overlaid (base64 data URL)
    maskImageUrl?: string           // Binary mask (white = furniture, black = background)
    furnitureType: string           // "chair", "desk", etc.
    numberOfImages: number          // How many variations to generate
    referenceImageUrl?: string      // Original furniture photo (before 3D conversion)
    furnitureMaskUrl?: string       // Segmentation mask from SAM3
}

function parseDataUrl(dataUrl: string): { mimeType: string; data: string } {
    const commaIndex = dataUrl.indexOf(',')
    if (commaIndex === -1 || !dataUrl.includes('base64')) {
        throw new Error('Invalid image data URL format')
    }
    const header = dataUrl.substring(0, commaIndex)
    const mimeMatch = header.match(/^data:([^;]+)/)
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/png'
    const data = dataUrl.substring(commaIndex + 1)
    return { mimeType, data }
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

        // Extract base64 data from composite image
        let imageData: string
        let mimeType: string = 'image/png'

        if (compositeImageUrl.startsWith('data:')) {
            const parsed = parseDataUrl(compositeImageUrl)
            imageData = parsed.data
            mimeType = parsed.mimeType
        } else {
            const response = await fetch(compositeImageUrl)
            const buffer = await response.arrayBuffer()
            imageData = Buffer.from(buffer).toString('base64')
            mimeType = response.headers.get('content-type') || 'image/png'
        }

        // Prepare prompt parts: composite image + optional mask + text prompt
        const promptParts: any[] = [
            {
                inlineData: {
                    mimeType,
                    data: imageData,
                },
            }
        ]

        // Add mask if available
        if (maskImageUrl && maskImageUrl.startsWith('data:')) {
            try {
                const parsedMask = parseDataUrl(maskImageUrl)
                promptParts.push({
                    inlineData: {
                        mimeType: parsedMask.mimeType,
                        data: parsedMask.data,
                    },
                })
            } catch (e) {
                console.warn('Failed to parse mask image:', e)
            }
        }

        // Add original furniture reference photo so Gemini can see true texture/material
        if (referenceImageUrl && referenceImageUrl.startsWith('data:')) {
            try {
                const parsedRef = parseDataUrl(referenceImageUrl)
                promptParts.push({
                    inlineData: {
                        mimeType: parsedRef.mimeType,
                        data: parsedRef.data,
                    },
                })

                // Add the segmentation mask for the reference image
                if (furnitureMaskUrl && furnitureMaskUrl.startsWith('data:')) {
                    const parsedFurnitureMask = parseDataUrl(furnitureMaskUrl)
                    promptParts.push({
                        inlineData: {
                            mimeType: parsedFurnitureMask.mimeType,
                            data: parsedFurnitureMask.data,
                        },
                    })
                }
            } catch (e) {
                console.warn('Failed to parse reference image:', e)
            }
        }

        const promptText = getNaturalizePrompt(furnitureType)
        promptParts.push({ text: promptText })

        const model = genAI.getGenerativeModel({
            model: 'gemini-3.1-flash-image-preview',
            generationConfig: {
                // @ts-expect-error - responseModalities is valid for image generation
                responseModalities: ['Text', 'Image'],
            },
        })

        console.log(`Calling Gemini for naturalization (${numImages} images in parallel)...`)

        // Generate multiple images in parallel (model doesn't support candidateCount)
        const generationPromises = Array.from({ length: numImages }, async (_, idx) => {
            const result = await model.generateContent(promptParts)
            const response = result.response
            const candidates = response.candidates

            if (candidates && candidates.length > 0) {
                const candidate = candidates[0]
                if (candidate.content?.parts) {
                    for (const part of candidate.content.parts) {
                        if ('inlineData' in part && part.inlineData) {
                            const base64Data = part.inlineData.data
                            const partMimeType = part.inlineData.mimeType || 'image/png'
                            return {
                                url: `data:${partMimeType};base64,${base64Data}`,
                            }
                        }
                    }
                }
            }
            throw new Error(`No image returned for generation ${idx + 1}`)
        })

        const settled = await Promise.allSettled(generationPromises)
        const images: Array<{ url: string }> = []

        for (const result of settled) {
            if (result.status === 'fulfilled') {
                images.push(result.value)
            } else {
                console.error('Generation failed:', result.reason)
            }
        }

        if (images.length === 0) {
            return NextResponse.json(
                { error: 'Gemini did not generate any images. It may have refused due to content policies.' },
                { status: 500 }
            )
        }

        console.log(`Generated ${images.length} naturalized image(s)`)

        return NextResponse.json({ images })
    } catch (error) {
        console.error('Naturalization error:', error)
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Naturalization failed' },
            { status: 500 }
        )
    }
}
