const MODAL_SAM3_TRACKER_URL = process.env.MODAL_SAM3_TRACKER_URL?.trim()
const MODAL_SAM3_URL = process.env.MODAL_SAM3_URL?.trim()
const RUNPOD_SAM3_URL = process.env.RUNPOD_SAM3_URL?.trim()
const RUNPOD_SAM3_TRACKER_ENDPOINT_ID = process.env.RUNPOD_SAM3_TRACKER_ENDPOINT_ID?.trim()
const RUNPOD_SAM3_ENDPOINT_ID = process.env.RUNPOD_SAM3_ENDPOINT_ID?.trim()
const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY?.trim()

const POLL_INTERVAL_MS = 1200
const MAX_WAIT_MS = 120000
const RETRY_DELAYS_MS = [500, 1500, 3000]

export interface Sam3Target {
    url: string
    serverless: boolean
    requiresAuth: boolean
}

export function resolveSam3Target(): Sam3Target | null {
    if (MODAL_SAM3_TRACKER_URL) {
        return {
            url: MODAL_SAM3_TRACKER_URL,
            serverless: true,
            requiresAuth: false,
        }
    }

    if (MODAL_SAM3_URL) {
        return {
            url: MODAL_SAM3_URL,
            serverless: true,
            requiresAuth: false,
        }
    }

    if (RUNPOD_SAM3_TRACKER_ENDPOINT_ID) {
        return {
            url: `https://api.runpod.ai/v2/${RUNPOD_SAM3_TRACKER_ENDPOINT_ID}/runsync`,
            serverless: true,
            requiresAuth: true,
        }
    }

    if (RUNPOD_SAM3_ENDPOINT_ID) {
        return {
            url: `https://api.runpod.ai/v2/${RUNPOD_SAM3_ENDPOINT_ID}/runsync`,
            serverless: true,
            requiresAuth: true,
        }
    }

    if (!RUNPOD_SAM3_URL) {
        return null
    }

    return {
        url: RUNPOD_SAM3_URL,
        serverless: isServerlessUrl(RUNPOD_SAM3_URL),
        requiresAuth: isRunpodServerlessUrl(RUNPOD_SAM3_URL),
    }
}

export function getRunpodApiKey(): string | undefined {
    return RUNPOD_API_KEY
}

export function buildServerlessUrl(url: string): string {
    if (isModalUrl(url)) return url.replace(/\/$/, '')
    if (url.endsWith('/runsync')) return url
    if (url.endsWith('/')) return `${url}runsync`
    if (url.includes('/run') || url.includes('/runsync')) return url
    return `${url}/runsync`
}

function buildServerlessStatusUrl(url: string, jobId: string): string {
    const base = url.replace(/\/runsync$/, '').replace(/\/run$/, '')
    return `${base}/status/${jobId}`
}

function isServerlessUrl(url: string): boolean {
    return isRunpodServerlessUrl(url) || url.includes('.modal.run') || url.includes('/runsync')
}

function isRunpodServerlessUrl(url: string): boolean {
    return url.includes('api.runpod.ai/v2/')
}

function isModalUrl(url: string): boolean {
    return url.includes('.modal.run')
}

function isTerminalStatus(status?: string): boolean {
    return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED' || status === 'TIMED_OUT'
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetriableStatus(status: number): boolean {
    return status === 429 || status === 502 || status === 503 || status === 504
}

function isRetriableNetworkError(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    const code = (error as Error & { cause?: { code?: string } })?.cause?.code
    return code === 'UND_ERR_CONNECT_TIMEOUT'
        || code === 'UND_ERR_HEADERS_TIMEOUT'
        || code === 'UND_ERR_SOCKET'
        || code === 'ECONNRESET'
        || code === 'ETIMEDOUT'
        || code === 'EAI_AGAIN'
}

export async function fetchWithRetry(
    url: string,
    init: RequestInit,
    label: string
): Promise<Response> {
    let attempt = 0

    while (true) {
        try {
            const response = await fetch(url, init)
            if (isRetriableStatus(response.status) && attempt < RETRY_DELAYS_MS.length) {
                const delay = RETRY_DELAYS_MS[attempt]
                attempt += 1
                console.warn(`[SAM3] ${label} retrying after HTTP ${response.status} (attempt ${attempt})`)
                await sleep(delay)
                continue
            }
            return response
        } catch (error) {
            if (isRetriableNetworkError(error) && attempt < RETRY_DELAYS_MS.length) {
                const delay = RETRY_DELAYS_MS[attempt]
                attempt += 1
                console.warn(`[SAM3] ${label} retrying after network error (attempt ${attempt})`, error)
                await sleep(delay)
                continue
            }
            throw error
        }
    }
}

export async function waitForServerlessOutput(
    initialRaw: unknown,
    targetUrl: string,
    headers: Record<string, string>
): Promise<unknown> {
    let raw = initialRaw as { status?: string; id?: string; error?: string; output?: unknown }
    let status = raw?.status
    const jobId = raw?.id

    if (status && status !== 'COMPLETED') {
        if (!jobId) {
            throw new Error(`RunPod serverless returned ${status} without a job id`)
        }

        const started = Date.now()
        while (!isTerminalStatus(status)) {
            if (Date.now() - started > MAX_WAIT_MS) {
                throw new Error(`RunPod job timeout waiting for completion (${status})`)
            }

            await sleep(POLL_INTERVAL_MS)

            const statusRes = await fetchWithRetry(buildServerlessStatusUrl(targetUrl, jobId), {
                method: 'GET',
                headers,
            }, 'segment status poll')

            if (!statusRes.ok) {
                const text = await statusRes.text()
                throw new Error(`RunPod status check failed: ${statusRes.status} ${text}`)
            }

            raw = await statusRes.json()
            status = raw?.status
        }
    }

    if (raw?.status && raw.status !== 'COMPLETED') {
        throw new Error(`RunPod job failed: ${raw.status} ${raw?.error ?? 'unknown error'}`)
    }

    return raw?.output ?? raw
}
