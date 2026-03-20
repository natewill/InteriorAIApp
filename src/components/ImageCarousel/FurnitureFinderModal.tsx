'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DetectResponse,
  Detection,
  ProductMatch,
  SearchDebug,
  SearchResponse,
} from '@/types/furnitureFinder';

interface FurnitureFinderModalProps {
  imageUrl: string;
  imageIndex: number;
  isOpen: boolean;
  onClose: () => void;
}

type SearchState =
  | { kind: 'idle' }
  | { kind: 'loading'; detectionId: string }
  | { kind: 'error'; detectionId: string; message: string; code: string }
  | { kind: 'results'; detectionId: string; products: ProductMatch[]; debug: SearchDebug };

type FinderState =
  | { kind: 'detecting' }
  | { kind: 'detectError'; message: string; code: string }
  | { kind: 'ready'; detections: Detection[]; search: SearchState };

class RequestError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseApiError(body: unknown, fallbackMessage: string, fallbackCode: string): RequestError {
  if (!isRecord(body)) {
    return new RequestError(fallbackMessage, fallbackCode);
  }

  const message = typeof body.error === 'string' ? body.error : fallbackMessage;
  const code = typeof body.code === 'string' ? body.code : fallbackCode;
  return new RequestError(message, code);
}

function isDetectResponse(value: unknown): value is DetectResponse {
  return isRecord(value) && typeof value.imageId === 'string' && Array.isArray(value.detections);
}

function isSearchResponse(value: unknown): value is SearchResponse {
  return isRecord(value) && Array.isArray(value.results) && isRecord(value.debug);
}

const POLYGON_COLORS = [
  '#3b82f6',
  '#14b8a6',
  '#f97316',
  '#8b5cf6',
  '#e11d48',
  '#84cc16',
  '#0ea5e9',
  '#f59e0b',
] as const;

function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`);
}

function getActiveDetectionId(search: SearchState): string | null {
  switch (search.kind) {
    case 'idle':
      return null;
    case 'loading':
    case 'error':
    case 'results':
      return search.detectionId;
    default:
      return assertNever(search);
  }
}

function getColor(index: number): string {
  return POLYGON_COLORS[index % POLYGON_COLORS.length];
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

export default function FurnitureFinderModal({
  imageUrl,
  imageIndex,
  isOpen,
  onClose,
}: FurnitureFinderModalProps) {
  const [state, setState] = useState<FinderState>({ kind: 'detecting' });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [hoveredDetectionId, setHoveredDetectionId] = useState<string | null>(null);
  const [detectRequestNonce, setDetectRequestNonce] = useState(0);
  const [detectLongWait, setDetectLongWait] = useState(false);
  const [searchLongWait, setSearchLongWait] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let cancelled = false;
    setState({ kind: 'detecting' });

    const loadDetections = async () => {
      try {
        const response = await fetch('/api/furniture-finder/detect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl }),
        });

        const body = await response.json() as unknown;
        if (!response.ok) {
          throw parseApiError(body, 'Furniture detection failed', 'detect_failed');
        }
        if (!isDetectResponse(body)) {
          throw new RequestError('Furniture detection failed', 'detect_failed');
        }

        if (cancelled) {
          return;
        }

        setState({
          kind: 'ready',
          detections: body.detections,
          search: { kind: 'idle' },
        });
      } catch (error: unknown) {
        if (cancelled) {
          return;
        }

        const requestError =
          error instanceof RequestError
            ? error
            : new RequestError('Furniture detection failed', 'detect_failed');

        setState({
          kind: 'detectError',
          message: requestError.message,
          code: requestError.code,
        });
      }
    };

    void loadDetections();

    return () => {
      cancelled = true;
    };
  }, [isOpen, imageUrl, detectRequestNonce]);

  useEffect(() => {
    if (state.kind !== 'detecting') {
      setDetectLongWait(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      setDetectLongWait(true);
    }, 8000);

    return () => window.clearTimeout(timeout);
  }, [state.kind]);

  useEffect(() => {
    if (state.kind !== 'ready' || state.search.kind !== 'loading') {
      setSearchLongWait(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      setSearchLongWait(true);
    }, 8000);

    return () => window.clearTimeout(timeout);
  }, [state]);

  const retryDetection = () => {
    setDetectRequestNonce((previous) => previous + 1);
  };

  const retrySearch = () => {
    const current = state;
    if (current.kind !== 'ready') {
      return;
    }

    const search = current.search;
    if (search.kind !== 'error') {
      return;
    }

    const detectionId = search.detectionId;
    const detection = current.detections.find((item) => item.id === detectionId);
    if (!detection) {
      return;
    }

    handleDetectionClick(detection);
  };

  const handleDetectionClick = (detection: Detection) => {
    if (state.kind !== 'ready') {
      return;
    }

    const detections = state.detections;
    setState({ kind: 'ready', detections, search: { kind: 'loading', detectionId: detection.id } });

    const loadProducts = async () => {
      try {
        const response = await fetch('/api/furniture-finder/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageUrl,
            detection,
          }),
        });

        const body = await response.json() as unknown;
        if (!response.ok) {
          throw parseApiError(body, 'Furniture search failed', 'search_failed');
        }
        if (!isSearchResponse(body)) {
          throw new RequestError('Furniture search failed', 'search_failed');
        }

        setState({
          kind: 'ready',
          detections,
          search: {
            kind: 'results',
            detectionId: detection.id,
            products: body.results,
            debug: body.debug,
          },
        });
      } catch (error: unknown) {
        const requestError =
          error instanceof RequestError
            ? error
            : new RequestError('Furniture search failed', 'search_failed');

        setState({
          kind: 'ready',
          detections,
          search: {
            kind: 'error',
            detectionId: detection.id,
            message: requestError.message,
            code: requestError.code,
          },
        });
      }
    };

    void loadProducts();
  };

  const activeDetectionId = useMemo(() => {
    if (state.kind !== 'ready') {
      return null;
    }
    return getActiveDetectionId(state.search);
  }, [state]);

  const content = !isOpen ? null : (
    <div className="fixed inset-0 z-[80] bg-black/85 p-4 sm:p-6" onClick={onClose}>
      <div
        className="mx-auto flex h-full w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950 shadow-2xl lg:flex-row"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex min-h-0 flex-1 flex-col border-b border-zinc-800 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3 sm:px-5">
            <div>
              <p className="text-sm font-semibold text-zinc-100">Furniture Finder</p>
              <p className="text-xs text-zinc-400">Result {imageIndex + 1}</p>
            </div>
            <button
              onClick={onClose}
              className="rounded-full bg-zinc-800 px-3 py-1 text-sm text-zinc-200 transition hover:bg-zinc-700"
            >
              Close
            </button>
          </div>

          <div className="relative flex min-h-0 flex-1 items-center justify-center bg-zinc-900 p-4">
            <img
              src={imageUrl}
              alt={`Result ${imageIndex + 1}`}
              className="max-h-full w-auto max-w-full rounded-lg object-contain"
              onLoad={(event) => {
                setImageSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                });
              }}
              draggable={false}
            />

            {state.kind === 'ready' && imageSize.width > 0 && imageSize.height > 0 && (
              <svg
                className="pointer-events-none absolute inset-4 h-[calc(100%-2rem)] w-[calc(100%-2rem)]"
                viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
                preserveAspectRatio="xMidYMid meet"
              >
                {state.detections.map((detection, index) => {
                  if (!detection.mask || detection.mask.polygon.length < 3) {
                    return null;
                  }

                  const color = getColor(index);
                  const isHovered = hoveredDetectionId === detection.id;
                  const isActive = activeDetectionId === detection.id;

                  return (
                    <polygon
                      key={detection.id}
                      points={detection.mask.polygon.map((point) => `${point.x},${point.y}`).join(' ')}
                      fill={isHovered || isActive ? `${color}66` : `${color}2A`}
                      stroke={color}
                      strokeWidth={isHovered || isActive ? 3 : 2}
                      className="pointer-events-auto cursor-pointer transition-all"
                      onMouseEnter={() => setHoveredDetectionId(detection.id)}
                      onMouseLeave={() => setHoveredDetectionId(null)}
                      onClick={() => handleDetectionClick(detection)}
                    />
                  );
                })}
              </svg>
            )}
          </div>

          <div className="border-t border-zinc-800 p-3 sm:p-4">
            {state.kind === 'detecting' && (
              <div className="space-y-1">
                <p className="text-sm text-zinc-300">Detecting furniture in this image...</p>
                {detectLongWait && (
                  <p className="text-xs text-amber-300">Model warmup can take a bit. We retry automatically on cold starts.</p>
                )}
              </div>
            )}
            {state.kind === 'detectError' && (
              <div className="space-y-2">
                <p className="text-sm text-red-300">{state.message}</p>
                {state.code === 'model_warming' && (
                  <p className="text-xs text-amber-300">Model is warming up. Retry in a few seconds.</p>
                )}
                <button
                  onClick={retryDetection}
                  className="rounded-md border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-100 transition hover:bg-zinc-700"
                >
                  Retry Detection
                </button>
              </div>
            )}
            {state.kind === 'ready' && (
              <div className="space-y-3">
                <p className="text-xs text-zinc-400">
                  Found {state.detections.length} item{state.detections.length === 1 ? '' : 's'}. Click any item below or click a highlighted area.
                </p>
                <div className="flex flex-wrap gap-2">
                  {state.detections.map((detection, index) => {
                    const isActive = activeDetectionId === detection.id;
                    return (
                      <button
                        key={detection.id}
                        onClick={() => handleDetectionClick(detection)}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                          isActive
                            ? 'border-blue-400 bg-blue-500/20 text-blue-200'
                            : 'border-zinc-600 bg-zinc-800 text-zinc-200 hover:border-zinc-500 hover:bg-zinc-700'
                        }`}
                        style={!isActive ? { borderColor: getColor(index) } : undefined}
                      >
                        {detection.label} ({formatConfidence(detection.confidence)})
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex min-h-0 w-full flex-col lg:w-[460px]">
          <div className="border-b border-zinc-800 px-4 py-3 sm:px-5">
            <p className="text-sm font-semibold text-zinc-100">Matches</p>
            <p className="text-xs text-zinc-400">Shows where each piece of furniture comes from</p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
            {state.kind === 'detecting' && (
              <div className="space-y-1">
                <p className="text-sm text-zinc-300">Waiting for furniture detection...</p>
                {detectLongWait && (
                  <p className="text-xs text-amber-300">Warming model and retrying automatically if needed.</p>
                )}
              </div>
            )}

            {state.kind === 'detectError' && (
              <div className="space-y-2">
                <p className="text-sm text-red-300">Fix detection first, then search.</p>
                <button
                  onClick={retryDetection}
                  className="rounded-md border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-100 transition hover:bg-zinc-700"
                >
                  Retry Detection
                </button>
              </div>
            )}

            {state.kind === 'ready' && state.search.kind === 'idle' && (
              <p className="text-sm text-zinc-300">Select a furniture item to search for products.</p>
            )}

            {state.kind === 'ready' && state.search.kind === 'loading' && (
              <div className="space-y-2">
                <p className="text-sm text-zinc-200">Searching for product matches...</p>
                <p className="text-xs text-zinc-400">Crop -&gt; Upload -&gt; Google Lens</p>
                {searchLongWait && (
                  <p className="text-xs text-amber-300">Search is taking longer than normal. This can happen when providers are cold.</p>
                )}
              </div>
            )}

            {state.kind === 'ready' && state.search.kind === 'error' && (
              <div className="space-y-2">
                <p className="text-sm text-red-300">{state.search.message}</p>
                <button
                  onClick={retrySearch}
                  className="rounded-md border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-100 transition hover:bg-zinc-700"
                >
                  Retry Search
                </button>
              </div>
            )}

            {state.kind === 'ready' && state.search.kind === 'results' && (
              <div className="space-y-4">
                <p className="text-xs text-zinc-400">Found {state.search.products.length} product matches</p>

                {state.search.products.length === 0 && (
                  <p className="text-sm text-zinc-300">No product matches found for this item.</p>
                )}

                {state.search.products.length > 0 && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {state.search.products.map((product, index) => (
                      <a
                        key={`${product.url}-${index}`}
                        href={product.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 transition hover:border-zinc-500"
                      >
                        <div className="aspect-square overflow-hidden bg-zinc-800">
                          <img
                            src={product.thumbnailUrl || product.imageUrl}
                            alt={product.title}
                            className="h-full w-full object-cover"
                          />
                        </div>
                        <div className="space-y-2 p-3">
                          <p className="line-clamp-2 text-sm font-medium text-zinc-100">{product.title}</p>
                          {product.price && <p className="text-sm font-semibold text-emerald-300">{product.price}</p>}
                          <p className="truncate text-xs text-zinc-400">{product.domain}</p>
                        </div>
                      </a>
                    ))}
                  </div>
                )}

                <details className="rounded-lg border border-zinc-700 bg-zinc-900/70 p-3">
                  <summary className="cursor-pointer text-xs font-semibold text-zinc-200">Debug details</summary>
                  <div className="mt-2 space-y-2 text-xs text-zinc-400">
                    <p>Total: {state.search.debug.timingsMs.total}ms</p>
                    {state.search.debug.steps.map((step) => (
                      <p key={`${step.name}-${step.ms}`}>
                        {step.name}: {step.ms}ms{step.note ? ` (${step.note})` : ''}
                      </p>
                    ))}
                  </div>
                </details>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
