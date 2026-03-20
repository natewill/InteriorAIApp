import 'server-only';
import { Detection, PolygonPoint } from '@/types/furnitureFinder';

const SERVERLESS_POLL_INTERVAL_MS = 1200;

interface RunPodDetection {
  label: string;
  score: number;
  box: [number, number, number, number];
  polygon?: [number, number][];
}

interface RunPodDetectResponse {
  detections: RunPodDetection[];
  encode_ms: number;
  decode_ms: number;
  postprocess_ms?: number;
  total_ms: number;
}

interface RunPodServerlessResult<TOutput> {
  id?: string;
  status?: string;
  output?: TOutput;
  error?: string;
}

interface Sam3Target {
  serverless: boolean;
  url: string;
  apiKey: string | null;
}

interface DetectOptions {
  threshold: number;
  batchSize: number;
  timeoutMs: number;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`);
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function isServerlessUrl(url: string): boolean {
  return url.includes('api.runpod.ai/v2/') || url.includes('.modal.run') || url.includes('/runsync');
}

function buildServerlessRunUrl(url: string): string {
  if (url.includes('.modal.run')) return url.replace(/\/+$/, '');
  if (url.endsWith('/runsync')) return url;
  if (url.endsWith('/')) return `${url}runsync`;
  if (url.includes('/run') || url.includes('/runsync')) return url;
  return `${url}/runsync`;
}

function buildServerlessStatusUrl(url: string, jobId: string): string {
  const base = url.replace(/\/runsync$/, '').replace(/\/run$/, '');
  return `${base}/status/${jobId}`;
}

function isTerminalStatus(status: string): boolean {
  switch (status) {
    case 'COMPLETED':
    case 'FAILED':
    case 'CANCELLED':
    case 'TIMED_OUT':
      return true;
    case 'IN_QUEUE':
    case 'IN_PROGRESS':
      return false;
    default:
      return assertNever(status as never);
  }
}

function getRequiredApiKey(): string {
  const apiKey = (process.env.RUNPOD_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('RUNPOD_API_KEY is required for serverless SAM3 detector requests');
  }
  return apiKey;
}

function resolveSam3Target(): Sam3Target {
  const modalDetectorUrl = (process.env.MODAL_SAM3_DETECTOR_URL || '').trim();
  if (modalDetectorUrl) {
    const url = normalizeUrl(modalDetectorUrl);
    return {
      serverless: isServerlessUrl(url),
      url,
      apiKey: url.includes('api.runpod.ai/v2/') ? getRequiredApiKey() : null,
    };
  }

  const detectorEndpointId = (process.env.RUNPOD_SAM3_DETECTOR_ENDPOINT_ID || '').trim();
  if (detectorEndpointId) {
    return {
      serverless: true,
      url: `https://api.runpod.ai/v2/${detectorEndpointId}/runsync`,
      apiKey: getRequiredApiKey(),
    };
  }

  const runpodUrl = (process.env.RUNPOD_SAM3_URL || '').trim();
  if (!runpodUrl) {
    throw new Error('RUNPOD_SAM3_URL is not set');
  }

  const url = normalizeUrl(runpodUrl);
  if (isServerlessUrl(url) && url.includes('api.runpod.ai/v2/')) {
    return {
      serverless: true,
      url: buildServerlessRunUrl(url),
      apiKey: getRequiredApiKey(),
    };
  }

  return {
    serverless: false,
    url: `${url}/detect_form`,
    apiKey: null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertStatus(status: string): void {
  if (status === 'COMPLETED') return;
  if (status === 'FAILED' || status === 'CANCELLED' || status === 'TIMED_OUT') {
    throw new Error(`SAM3 detector job failed: ${status}`);
  }
}

async function waitForServerlessOutput(
  initialRaw: RunPodServerlessResult<RunPodDetectResponse>,
  runUrl: string,
  apiKey: string | null,
  timeoutMs: number,
  signal: AbortSignal
): Promise<RunPodDetectResponse> {
  let raw = initialRaw;
  let status = raw.status;

  if (!status || status === 'COMPLETED') {
    if (!raw.output) {
      throw new Error('SAM3 detector completed without output');
    }
    return raw.output;
  }

  if (!raw.id) {
    throw new Error(`SAM3 detector returned ${status} without job id`);
  }
  const jobId = raw.id;

  const startedAt = Date.now();
  while (!isTerminalStatus(status)) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`SAM3 detector timed out while ${status}`);
    }

    await sleep(SERVERLESS_POLL_INTERVAL_MS);

    const headers: Record<string, string> = {};
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const statusResponse = await fetch(buildServerlessStatusUrl(runUrl, jobId), {
      method: 'GET',
      headers,
      signal,
    });

    if (!statusResponse.ok) {
      const text = await statusResponse.text();
      throw new Error(`SAM3 detector status failed: ${statusResponse.status} - ${text}`);
    }

    raw = await statusResponse.json() as RunPodServerlessResult<RunPodDetectResponse>;
    status = raw.status || 'FAILED';
  }

  assertStatus(status);

  if (!raw.output) {
    throw new Error('SAM3 detector completed without output');
  }

  return raw.output;
}

async function resolveImageBlob(imageUrl: string): Promise<Blob> {
  if (imageUrl.startsWith('data:')) {
    const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      throw new Error('Invalid image data URL');
    }
    const mimeType = match[1];
    const bytes = Buffer.from(match[2], 'base64');
    return new Blob([bytes], { type: mimeType });
  }

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const mimeType = response.headers.get('content-type') || 'image/jpeg';
  return new Blob([arrayBuffer], { type: mimeType });
}

function toDetection(det: RunPodDetection, index: number): Detection {
  let mask: Detection['mask'] = null;

  if (det.polygon && det.polygon.length >= 3) {
    const polygon: PolygonPoint[] = det.polygon.map(([x, y]) => ({ x, y }));
    mask = { polygon, iou: det.score };
  }

  return {
    id: `det_${index}`,
    label: det.label,
    confidence: det.score,
    box: {
      x1: det.box[0],
      y1: det.box[1],
      x2: det.box[2],
      y2: det.box[3],
    },
    mask,
  };
}

export async function detectFurnitureWithSam3(
  imageUrl: string,
  options: Partial<DetectOptions> = {}
): Promise<Detection[]> {
  const threshold = options.threshold ?? 0.4;
  const batchSize = options.batchSize ?? 32;
  const timeoutMs = options.timeoutMs ?? 30000;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const target = resolveSam3Target();
    const imageBlob = await resolveImageBlob(imageUrl);
    let data: RunPodDetectResponse;

    if (target.serverless) {
      const bytes = new Uint8Array(await imageBlob.arrayBuffer());
      const imageBase64 = Buffer.from(bytes).toString('base64');
      const runUrl = buildServerlessRunUrl(target.url);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (target.apiKey) {
        headers.Authorization = `Bearer ${target.apiKey}`;
      }

      const response = await fetch(runUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          input: {
            action: 'detect_furniture',
            image: imageBase64,
            threshold,
            batch_size: batchSize,
            return_polygons: true,
            include_mask_base64: false,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`SAM3 detector failed: ${response.status} - ${text}`);
      }

      const raw = await response.json() as RunPodServerlessResult<RunPodDetectResponse>;
      data = await waitForServerlessOutput(raw, runUrl, target.apiKey, timeoutMs, controller.signal);
    } else {
      const formData = new FormData();
      formData.append('image', imageBlob, 'room.jpg');
      formData.append('threshold', String(threshold));
      formData.append('batch_size', String(batchSize));
      formData.append('return_polygons', 'true');
      formData.append('include_mask_base64', 'false');

      const response = await fetch(target.url, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`SAM3 detector failed: ${response.status} - ${text}`);
      }

      data = await response.json() as RunPodDetectResponse;
    }

    const postprocessMs = data.postprocess_ms ?? 0;
    console.log(
      `[furniture-finder] ${data.detections.length} detections in ${data.total_ms.toFixed(0)}ms ` +
      `(encode: ${data.encode_ms.toFixed(0)}ms, decode: ${data.decode_ms.toFixed(0)}ms, post: ${postprocessMs.toFixed(0)}ms)`
    );

    return data.detections.map(toDetection);
  } finally {
    clearTimeout(timeout);
  }
}
