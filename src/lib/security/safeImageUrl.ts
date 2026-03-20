import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

type SafeImageUrlResult =
  | { kind: 'ok'; normalizedUrl: string }
  | { kind: 'error'; status: number; code: SafeImageUrlErrorCode; message: string };

type SafeImageUrlErrorCode =
  | 'invalid_image_url'
  | 'unsupported_image_scheme'
  | 'blocked_image_host'
  | 'blocked_image_ip';

const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'metadata.google.internal',
  'metadata',
]);

function isValidDataImageUrl(imageUrl: string): boolean {
  return imageUrl.startsWith('data:image/') && imageUrl.includes(';base64,');
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts;

  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;

  return false;
}

function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase().split('%')[0];

  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
  if (lower.startsWith('2001:db8')) return true;

  if (lower.startsWith('::ffff:')) {
    const mapped = lower.slice('::ffff:'.length);
    if (isIP(mapped) === 4) {
      return isPrivateIpv4(mapped);
    }
  }

  return false;
}

function isBlockedIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    return isPrivateIpv4(address);
  }

  if (version === 6) {
    return isPrivateIpv6(address);
  }

  return true;
}

async function hasBlockedResolvedIp(hostname: string): Promise<boolean> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  if (records.length === 0) {
    return true;
  }

  return records.some((record) => isBlockedIp(record.address));
}

export async function validateInputImageUrl(imageUrl: string): Promise<SafeImageUrlResult> {
  const raw = imageUrl.trim();

  if (!raw) {
    return {
      kind: 'error',
      status: 400,
      code: 'invalid_image_url',
      message: 'imageUrl is required',
    };
  }

  if (isValidDataImageUrl(raw)) {
    return { kind: 'ok', normalizedUrl: raw };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(raw);
  } catch {
    return {
      kind: 'error',
      status: 400,
      code: 'invalid_image_url',
      message: 'imageUrl must be a valid URL or data URL',
    };
  }

  if (parsedUrl.protocol !== 'https:') {
    return {
      kind: 'error',
      status: 400,
      code: 'unsupported_image_scheme',
      message: 'Only https image URLs are allowed',
    };
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(hostname) || hostname.endsWith('.local')) {
    return {
      kind: 'error',
      status: 400,
      code: 'blocked_image_host',
      message: 'imageUrl host is blocked',
    };
  }

  if (isIP(hostname) !== 0) {
    if (isBlockedIp(hostname)) {
      return {
        kind: 'error',
        status: 400,
        code: 'blocked_image_ip',
        message: 'imageUrl IP is blocked',
      };
    }

    return { kind: 'ok', normalizedUrl: parsedUrl.toString() };
  }

  try {
    const blocked = await hasBlockedResolvedIp(hostname);
    if (blocked) {
      return {
        kind: 'error',
        status: 400,
        code: 'blocked_image_ip',
        message: 'imageUrl resolved to a blocked IP',
      };
    }
  } catch {
    return {
      kind: 'error',
      status: 400,
      code: 'blocked_image_host',
      message: 'imageUrl host could not be resolved safely',
    };
  }

  return { kind: 'ok', normalizedUrl: parsedUrl.toString() };
}
