import { createHash, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { DetectResponse, Detection } from '@/types/furnitureFinder';
import { detectFurnitureWithSam3 } from '@/lib/furnitureFinder/runpodSam3';
import { checkRateLimit, getClientIdentifier } from '@/lib/security/rateLimit';
import { validateInputImageUrl } from '@/lib/security/safeImageUrl';

const DUPLICATE_IOU = 0.85;
const RUNPOD_LABEL_BATCH_SIZE = Math.max(1, Number(process.env.RUNPOD_LABEL_BATCH_SIZE || 32));
const DETECTOR_TIMEOUT_MS = 30_000;
const DETECTOR_RETRY_TIMEOUT_MS = 60_000;
const DETECT_RATE_LIMIT_MAX = 10;
const DETECT_RATE_LIMIT_WINDOW_MS = 60_000;
const DETECT_CACHE_TTL_MS = 5 * 60_000;

interface DetectBody {
  imageUrl?: string;
}

type DetectErrorCode =
  | 'invalid_request'
  | 'invalid_image_url'
  | 'unsupported_image_scheme'
  | 'blocked_image_host'
  | 'blocked_image_ip'
  | 'rate_limited'
  | 'model_warming'
  | 'detect_failed';

interface DetectCacheEntry {
  expiresAt: number;
  response: DetectResponse;
}

const detectCache = new Map<string, DetectCacheEntry>();

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function boxIoU(a: Box, b: Box): number {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);

  const intersectionWidth = Math.max(0, x2 - x1);
  const intersectionHeight = Math.max(0, y2 - y1);
  const intersectionArea = intersectionWidth * intersectionHeight;

  if (intersectionArea === 0) {
    return 0;
  }

  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  const union = areaA + areaB - intersectionArea;

  return intersectionArea / union;
}

function dedupeDetections(detections: Detection[]): Detection[] {
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const deduped: Detection[] = [];

  for (const candidate of sorted) {
    const duplicate = deduped.some((existing) => boxIoU(candidate.box, existing.box) >= DUPLICATE_IOU);
    if (!duplicate) {
      deduped.push(candidate);
    }
  }

  return deduped.map((detection, index) => ({
    ...detection,
    id: `det_${index}`,
  }));
}

function getCachedDetectResponse(cacheKey: string): DetectResponse | null {
  const entry = detectCache.get(cacheKey);
  if (!entry) {
    return null;
  }

  if (Date.now() >= entry.expiresAt) {
    detectCache.delete(cacheKey);
    return null;
  }

  return entry.response;
}

function setCachedDetectResponse(cacheKey: string, response: DetectResponse): void {
  detectCache.set(cacheKey, {
    response,
    expiresAt: Date.now() + DETECT_CACHE_TTL_MS,
  });
}

function isRetryableDetectorError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes('aborted') || message.includes('timeout');
}

async function detectWithRetry(imageUrl: string): Promise<Detection[]> {
  try {
    return await detectFurnitureWithSam3(imageUrl, {
      threshold: 0.4,
      batchSize: RUNPOD_LABEL_BATCH_SIZE,
      timeoutMs: DETECTOR_TIMEOUT_MS,
    });
  } catch (error) {
    if (!isRetryableDetectorError(error)) {
      throw error;
    }

    console.warn('SAM3 detector cold start detected, retrying once...');
    try {
      return await detectFurnitureWithSam3(imageUrl, {
        threshold: 0.4,
        batchSize: RUNPOD_LABEL_BATCH_SIZE,
        timeoutMs: DETECTOR_RETRY_TIMEOUT_MS,
      });
    } catch (retryError) {
      if (isRetryableDetectorError(retryError)) {
        throw new Error('SAM3 model is warming up. Please retry in a few seconds.');
      }
      throw retryError;
    }
  }
}

function toErrorCode(error: unknown): DetectErrorCode {
  if (!(error instanceof Error)) {
    return 'detect_failed';
  }

  const message = error.message.toLowerCase();
  if (message.includes('warming up')) return 'model_warming';
  return 'detect_failed';
}

function errorResponse(status: number, code: DetectErrorCode, message: string, retryAfterSeconds?: number): NextResponse {
  const headers = retryAfterSeconds
    ? { 'Retry-After': String(retryAfterSeconds) }
    : undefined;

  return NextResponse.json(
    { error: message, code },
    { status, headers },
  );
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const startedAt = Date.now();
  const rateLimit = checkRateLimit({
    routeKey: 'furniture-finder-detect',
    identifier: getClientIdentifier(request),
    maxRequests: DETECT_RATE_LIMIT_MAX,
    windowMs: DETECT_RATE_LIMIT_WINDOW_MS,
  });

  if (rateLimit.kind === 'limited') {
    console.warn('[furniture-detect]', {
      requestId,
      event: 'rate_limited',
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    });
    return errorResponse(
      429,
      'rate_limited',
      'Too many detect requests. Please wait and retry.',
      rateLimit.retryAfterSeconds,
    );
  }

  try {
    const body = await request.json() as DetectBody;
    const imageUrl = body.imageUrl;

    if (!imageUrl) {
      return errorResponse(400, 'invalid_request', 'imageUrl is required');
    }

    const validatedImageUrl = await validateInputImageUrl(imageUrl);
    if (validatedImageUrl.kind === 'error') {
      return errorResponse(validatedImageUrl.status, validatedImageUrl.code, validatedImageUrl.message);
    }

    const cacheKey = createHash('sha1').update(validatedImageUrl.normalizedUrl).digest('hex');
    const cached = getCachedDetectResponse(cacheKey);
    if (cached) {
      console.log('[furniture-detect]', {
        requestId,
        event: 'cache_hit',
        detections: cached.detections.length,
        elapsedMs: Date.now() - startedAt,
      });
      return NextResponse.json(cached, { headers: { 'X-Furniture-Cache': 'hit' } });
    }

    const detections = await detectWithRetry(validatedImageUrl.normalizedUrl);

    const response: DetectResponse = {
      imageId: createHash('sha1').update(validatedImageUrl.normalizedUrl).digest('hex').slice(0, 16),
      detections: dedupeDetections(detections),
    };
    setCachedDetectResponse(cacheKey, response);

    console.log('[furniture-detect]', {
      requestId,
      event: 'cache_miss',
      detections: response.detections.length,
      elapsedMs: Date.now() - startedAt,
    });

    return NextResponse.json(response, { headers: { 'X-Furniture-Cache': 'miss' } });
  } catch (error) {
    console.error('Furniture detection failed:', error);
    const code = toErrorCode(error);
    if (code === 'model_warming') {
      return errorResponse(503, code, 'SAM3 model is warming up. Please retry in a few seconds.');
    }

    return errorResponse(500, code, error instanceof Error ? error.message : 'Detection failed');
  }
}
