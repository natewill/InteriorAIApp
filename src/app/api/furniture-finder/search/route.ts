import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { SearchRequest, SearchResponse, SearchStep } from '@/types/furnitureFinder';
import { cropImage } from '@/lib/furnitureFinder/imageUtils';
import { uploadToImgbb } from '@/lib/furnitureFinder/imgbb';
import { reverseImageSearch } from '@/lib/furnitureFinder/serpapi';
import { checkRateLimit, getClientIdentifier } from '@/lib/security/rateLimit';
import { validateInputImageUrl } from '@/lib/security/safeImageUrl';

const SEARCH_RATE_LIMIT_MAX = 24;
const SEARCH_RATE_LIMIT_WINDOW_MS = 60_000;
const SEARCH_CACHE_TTL_MS = 10 * 60_000;

type SearchErrorCode =
  | 'invalid_request'
  | 'invalid_image_url'
  | 'unsupported_image_scheme'
  | 'blocked_image_host'
  | 'blocked_image_ip'
  | 'rate_limited'
  | 'search_failed';

interface SearchCacheEntry {
  expiresAt: number;
  response: SearchResponse;
}

const searchCache = new Map<string, SearchCacheEntry>();

function addStep(steps: SearchStep[], name: string, startedAt: number, note: string | null = null): number {
  const ms = Date.now() - startedAt;
  steps.push({ name, ms, note });
  return ms;
}

function getSearchCacheKey(imageUrl: string, body: SearchRequest): string {
  return createHash('sha1')
    .update(imageUrl)
    .update(body.detection.label)
    .update(JSON.stringify(body.detection.box))
    .digest('hex');
}

function getCachedSearchResponse(cacheKey: string): SearchResponse | null {
  const entry = searchCache.get(cacheKey);
  if (!entry) {
    return null;
  }

  if (Date.now() >= entry.expiresAt) {
    searchCache.delete(cacheKey);
    return null;
  }

  return entry.response;
}

function setCachedSearchResponse(cacheKey: string, response: SearchResponse): void {
  searchCache.set(cacheKey, {
    response,
    expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
  });
}

function errorResponse(status: number, code: SearchErrorCode, message: string, retryAfterSeconds?: number): NextResponse {
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
  const rateLimit = checkRateLimit({
    routeKey: 'furniture-finder-search',
    identifier: getClientIdentifier(request),
    maxRequests: SEARCH_RATE_LIMIT_MAX,
    windowMs: SEARCH_RATE_LIMIT_WINDOW_MS,
  });

  if (rateLimit.kind === 'limited') {
    console.warn('[furniture-search]', {
      requestId,
      event: 'rate_limited',
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    });
    return errorResponse(
      429,
      'rate_limited',
      'Too many search requests. Please wait and retry.',
      rateLimit.retryAfterSeconds,
    );
  }

  const startedAt = Date.now();
  const steps: SearchStep[] = [];

  try {
    const body = await request.json() as SearchRequest;

    if (!body.imageUrl || !body.detection) {
      return errorResponse(400, 'invalid_request', 'imageUrl and detection are required');
    }

    const validatedImageUrl = await validateInputImageUrl(body.imageUrl);
    if (validatedImageUrl.kind === 'error') {
      return errorResponse(validatedImageUrl.status, validatedImageUrl.code, validatedImageUrl.message);
    }

    const cacheKey = getSearchCacheKey(validatedImageUrl.normalizedUrl, body);
    const cached = getCachedSearchResponse(cacheKey);
    if (cached) {
      console.log('[furniture-search]', {
        requestId,
        event: 'cache_hit',
        results: cached.results.length,
        elapsedMs: Date.now() - startedAt,
      });
      return NextResponse.json(cached, { headers: { 'X-Furniture-Cache': 'hit' } });
    }

    const cropStartedAt = Date.now();
    const cropUrl = await cropImage(validatedImageUrl.normalizedUrl, body.detection.box, 0.15);
    const cropMs = addStep(steps, 'Crop image', cropStartedAt);

    const uploadStartedAt = Date.now();
    const imgbbUrl = await uploadToImgbb(cropUrl, 600);
    const uploadMs = addStep(steps, 'Upload crop', uploadStartedAt);

    const searchStartedAt = Date.now();
    const search = await reverseImageSearch(imgbbUrl);
    const searchMs = addStep(steps, 'Google Lens search', searchStartedAt, `${search.results.length} results`);

    const response: SearchResponse = {
      results: search.results,
      debug: {
        cropUrl,
        imgbbUrl,
        serpApiResults: search.debug,
        steps,
        timingsMs: {
          crop: cropMs,
          upload: uploadMs,
          search: searchMs,
          total: Date.now() - startedAt,
        },
      },
    };
    setCachedSearchResponse(cacheKey, response);

    console.log('[furniture-search]', {
      requestId,
      event: 'cache_miss',
      results: response.results.length,
      elapsedMs: Date.now() - startedAt,
    });

    return NextResponse.json(response, { headers: { 'X-Furniture-Cache': 'miss' } });
  } catch (error) {
    console.error('Furniture search failed:', error);
    return errorResponse(500, 'search_failed', error instanceof Error ? error.message : 'Search failed');
  }
}
