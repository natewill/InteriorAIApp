import { fal } from '@fal-ai/client'

// Configure fal client with API key from environment
fal.config({
    credentials: process.env.FAL_KEY,
})

export { fal }
