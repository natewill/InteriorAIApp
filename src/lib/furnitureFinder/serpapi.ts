import { ProductMatch, SerpApiDebug } from '@/types/furnitureFinder';

const SERPAPI_URL = 'https://serpapi.com/search';

const BLOCKED_DOMAINS = [
  'pinterest.com',
  'pin.it',
  'instagram.com',
  'facebook.com',
  'tiktok.com',
  'x.com',
  'twitter.com',
  'reddit.com',
  'youtube.com',
  'youtu.be',
  'wikipedia.org',
  'wikimedia.org',
  'shutterstock.com',
  'istockphoto.com',
  'gettyimages.com',
  'unsplash.com',
  'pexels.com',
  'pixabay.com',
] as const;

const PRODUCT_PATTERNS = [
  /\/product\//i,
  /\/products\//i,
  /\/p\//i,
  /\/dp\//i,
  /\/itm\//i,
  /\/item\//i,
  /[?&]sku=/i,
  /[?&]product=/i,
] as const;

interface LensPrice {
  value: string;
}

interface LensMatch {
  title: string;
  link: string;
  source: string;
  image?: string;
  thumbnail: string;
  price?: LensPrice;
}

interface LensResponse {
  error?: string;
  visual_matches?: LensMatch[];
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function isBlockedDomain(domain: string): boolean {
  const lower = domain.toLowerCase();
  return BLOCKED_DOMAINS.some((blocked) => lower === blocked || lower.endsWith(`.${blocked}`));
}

function looksLikeProductPage(url: string): boolean {
  return PRODUCT_PATTERNS.some((pattern) => pattern.test(url));
}

export async function reverseImageSearch(imageUrl: string): Promise<{ results: ProductMatch[]; debug: SerpApiDebug }> {
  const apiKey = (process.env.SERPAPI_KEY || '').trim();
  if (!apiKey) {
    throw new Error('SERPAPI_KEY is not set');
  }

  const params = new URLSearchParams({
    engine: 'google_lens',
    type: 'products',
    safe: 'active',
    url: imageUrl,
    api_key: apiKey,
    hl: 'en',
  });

  const response = await fetch(`${SERPAPI_URL}?${params.toString()}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SerpAPI request failed: ${response.status} - ${text}`);
  }

  const data = await response.json() as LensResponse;
  if (data.error) {
    throw new Error(data.error);
  }

  const matches = data.visual_matches || [];
  const seenUrls = new Set<string>();
  const blockedDomains: string[] = [];
  const results: ProductMatch[] = [];

  for (const match of matches) {
    if (seenUrls.has(match.link)) {
      continue;
    }
    seenUrls.add(match.link);

    const domain = extractDomain(match.link);
    if (isBlockedDomain(domain)) {
      if (!blockedDomains.includes(domain)) {
        blockedDomains.push(domain);
      }
      continue;
    }

    results.push({
      title: match.title || 'Product',
      url: match.link,
      imageUrl: match.image || match.thumbnail,
      thumbnailUrl: match.thumbnail,
      domain,
      source: looksLikeProductPage(match.link) || !!match.price ? 'serpapi_product' : 'serpapi_general',
      price: match.price?.value || null,
    });
  }

  results.sort((a, b) => {
    const aRank = a.source === 'serpapi_product' ? 0 : 1;
    const bRank = b.source === 'serpapi_product' ? 0 : 1;
    return aRank - bRank;
  });

  return {
    results: results.slice(0, 20),
    debug: {
      totalFromApi: matches.length,
      filteredCount: results.length,
      blockedDomains,
    },
  };
}
