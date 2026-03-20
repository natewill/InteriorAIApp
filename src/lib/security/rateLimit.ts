import { NextRequest } from 'next/server';

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

interface RateLimitParams {
  routeKey: string;
  identifier: string;
  maxRequests: number;
  windowMs: number;
}

type RateLimitResult =
  | { kind: 'ok' }
  | { kind: 'limited'; retryAfterSeconds: number };

const buckets = new Map<string, RateLimitBucket>();

function cleanupStaleBuckets(now: number): void {
  if (buckets.size < 2000) {
    return;
  }

  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) {
      buckets.delete(key);
    }
  }
}

export function checkRateLimit(params: RateLimitParams): RateLimitResult {
  const now = Date.now();
  cleanupStaleBuckets(now);

  const key = `${params.routeKey}:${params.identifier}`;
  const existing = buckets.get(key);

  if (!existing || now >= existing.resetAt) {
    buckets.set(key, {
      count: 1,
      resetAt: now + params.windowMs,
    });
    return { kind: 'ok' };
  }

  if (existing.count >= params.maxRequests) {
    return {
      kind: 'limited',
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  buckets.set(key, existing);
  return { kind: 'ok' };
}

export function getClientIdentifier(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const ip = forwardedFor.split(',')[0].trim();
    if (ip) {
      return ip;
    }
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  const cloudflareIp = request.headers.get('cf-connecting-ip');
  if (cloudflareIp) {
    return cloudflareIp;
  }

  const userAgent = request.headers.get('user-agent') || 'unknown';
  return `ua:${userAgent.slice(0, 80)}`;
}
