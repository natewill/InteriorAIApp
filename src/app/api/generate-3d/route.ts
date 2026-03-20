import { NextRequest, NextResponse } from 'next/server'
import { fal } from '@/lib/fal-client'

interface SAM3DInput {
    image_url: string
    mask_urls?: string[]
    prompt?: string
    export_textured_glb?: boolean
}

interface SAM3DFile {
    url: string
    content_type: string
    file_name?: string
    file_size?: number
}

interface SAM3DOutput {
    model_glb: SAM3DFile | string
    gaussian_splat: SAM3DFile
    metadata: unknown[]
    individual_glbs?: SAM3DFile[]
}

function dataURLtoFile(dataurl: string, filename: string): File {
    const arr = dataurl.split(',')
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png'
    const bstr = atob(arr[1])
    let n = bstr.length
    const u8arr = new Uint8Array(n)
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n)
    }
    return new File([u8arr], filename, { type: mime })
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { imageUrl, maskUrl } = body as {
            imageUrl: string
            maskUrl?: string
        }

        if (!imageUrl) {
            return NextResponse.json(
                { error: 'Image URL is required' },
                { status: 400 }
            )
        }

        // If it's a data URL, upload to fal.ai storage first
        let finalImageUrl = imageUrl
        if (imageUrl.startsWith('data:')) {
            console.log('Uploading image to fal.ai storage...')
            const file = dataURLtoFile(imageUrl, 'furniture-image.png')
            finalImageUrl = await fal.storage.upload(file)
            console.log('Uploaded to:', finalImageUrl)
        }

        const input: SAM3DInput = {
            image_url: finalImageUrl,
            export_textured_glb: true,
        }

        // If we have a mask URL from 2D segmentation, upload and use it
        if (maskUrl) {
            let finalMaskUrl = maskUrl
            if (maskUrl.startsWith('data:')) {
                console.log('Uploading mask to fal.ai storage...')
                const maskFile = dataURLtoFile(maskUrl, 'furniture-mask.png')
                finalMaskUrl = await fal.storage.upload(maskFile)
                console.log('Mask uploaded to:', finalMaskUrl)
            }
            input.mask_urls = [finalMaskUrl]
        } else {
            input.prompt = "furniture"
        }

        console.log('Calling SAM3 3D Objects API...')
        console.log('Input:', JSON.stringify(input, null, 2))

        const result = await fal.subscribe('fal-ai/sam-3/3d-objects', {
            input,
            logs: true,
            onQueueUpdate: (update) => {
                if (update.status === 'IN_PROGRESS') {
                    console.log('3D generation in progress...')
                }
            },
        })

        const output = result.data as SAM3DOutput

        console.log('SAM3 3D response:', {
            hasGlb: !!output?.model_glb,
            hasSplat: !!output?.gaussian_splat,
        })

        let glbUrl: string | null = null
        if (typeof output?.model_glb === 'string') {
            glbUrl = output.model_glb
        } else if (output?.model_glb?.url) {
            glbUrl = output.model_glb.url
        }

        if (!glbUrl) {
            console.error('SAM3 3D full response:', JSON.stringify(output, null, 2))
            return NextResponse.json(
                { error: '3D generation did not return a GLB model. Check the console.' },
                { status: 500 }
            )
        }

        return NextResponse.json({
            glbUrl,
            splatUrl: output.gaussian_splat?.url || null,
            metadata: output.metadata,
        })
    } catch (error: unknown) {
        console.error('3D generation error:', error)
        if (error && typeof error === 'object' && 'body' in error) {
            console.error('Error body:', JSON.stringify((error as { body: unknown }).body, null, 2))
        }
        return NextResponse.json(
            { error: error instanceof Error ? error.message : '3D generation failed' },
            { status: 500 }
        )
    }
}
