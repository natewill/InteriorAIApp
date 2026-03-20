export interface BoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PolygonPoint {
  x: number;
  y: number;
}

export interface DetectionMask {
  polygon: PolygonPoint[];
  iou: number;
}

export interface Detection {
  id: string;
  label: string;
  confidence: number;
  box: BoundingBox;
  mask: DetectionMask | null;
}

export interface DetectResponse {
  imageId: string;
  detections: Detection[];
}

export interface ProductMatch {
  title: string;
  url: string;
  imageUrl: string;
  thumbnailUrl: string;
  domain: string;
  source: 'serpapi_product' | 'serpapi_general';
  price: string | null;
}

export interface SerpApiDebug {
  totalFromApi: number;
  filteredCount: number;
  blockedDomains: string[];
}

export interface SearchStep {
  name: string;
  ms: number;
  note: string | null;
}

export interface SearchTimings {
  crop: number;
  upload: number;
  search: number;
  total: number;
}

export interface SearchDebug {
  cropUrl: string;
  imgbbUrl: string;
  serpApiResults: SerpApiDebug;
  steps: SearchStep[];
  timingsMs: SearchTimings;
}

export interface SearchResponse {
  results: ProductMatch[];
  debug: SearchDebug;
}

export interface SearchRequest {
  imageUrl: string;
  detection: Detection;
}
