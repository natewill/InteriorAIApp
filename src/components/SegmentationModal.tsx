'use client';

import { useRef, useState, useCallback, useEffect, MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { SegmentPoint } from '@/types';

/**
 * Flood-fills from image edges to find all "exterior" background pixels,
 * then builds an outline only where mask pixels border the exterior.
 * Internal holes and fuzz are ignored.
 */
function extractMaskOutline(maskSrc: string, thickness: number = 5): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const { naturalWidth: w, naturalHeight: h } = img;

            const srcCanvas = document.createElement('canvas');
            srcCanvas.width = w;
            srcCanvas.height = h;
            const srcCtx = srcCanvas.getContext('2d')!;
            srcCtx.drawImage(img, 0, 0);
            const srcData = srcCtx.getImageData(0, 0, w, h).data;

            const isMask = (x: number, y: number) => {
                if (x < 0 || y < 0 || x >= w || y >= h) return false;
                return srcData[(y * w + x) * 4] > 128;
            };

            // Flood-fill from edges to mark exterior background
            const exterior = new Uint8Array(w * h);
            const queue: number[] = [];

            // Seed all edge pixels that are background
            for (let x = 0; x < w; x++) {
                if (!isMask(x, 0))     queue.push(0 * w + x);
                if (!isMask(x, h - 1)) queue.push((h - 1) * w + x);
            }
            for (let y = 1; y < h - 1; y++) {
                if (!isMask(0, y))     queue.push(y * w + 0);
                if (!isMask(w - 1, y)) queue.push(y * w + (w - 1));
            }
            for (const idx of queue) exterior[idx] = 1;

            // BFS flood fill
            let head = 0;
            while (head < queue.length) {
                const idx = queue[head++];
                const px = idx % w;
                const py = (idx - px) / w;
                const neighbors = [
                    py > 0     ? idx - w : -1,
                    py < h - 1 ? idx + w : -1,
                    px > 0     ? idx - 1 : -1,
                    px < w - 1 ? idx + 1 : -1,
                ];
                for (const ni of neighbors) {
                    if (ni < 0 || exterior[ni]) continue;
                    const nx = ni % w;
                    const ny = (ni - nx) / w;
                    if (isMask(nx, ny)) continue;
                    exterior[ni] = 1;
                    queue.push(ni);
                }
            }

            const isExterior = (x: number, y: number) => {
                if (x < 0 || y < 0 || x >= w || y >= h) return true;
                return exterior[y * w + x] === 1;
            };

            // Build outline: mask pixels near exterior background
            const outCanvas = document.createElement('canvas');
            outCanvas.width = w;
            outCanvas.height = h;
            const outCtx = outCanvas.getContext('2d')!;
            const outImg = outCtx.createImageData(w, h);

            const t = Math.max(1, thickness);
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    if (!isMask(x, y)) continue;
                    let nearExterior = false;
                    for (let dy = -t; dy <= t && !nearExterior; dy++) {
                        for (let dx = -t; dx <= t && !nearExterior; dx++) {
                            if (dx === 0 && dy === 0) continue;
                            if (isExterior(x + dx, y + dy)) nearExterior = true;
                        }
                    }
                    if (nearExterior) {
                        const idx = (y * w + x) * 4;
                        outImg.data[idx]     = 34;
                        outImg.data[idx + 1] = 197;
                        outImg.data[idx + 2] = 94;
                        outImg.data[idx + 3] = 230;
                    }
                }
            }

            outCtx.putImageData(outImg, 0, 0);
            resolve(outCanvas.toDataURL('image/png'));
        };
        img.onerror = reject;
        img.src = maskSrc;
    });
}

interface SegmentationModalProps {
    imageUrl: string;
    initialPoints?: SegmentPoint[];
    initialMaskUrl?: string | null;
    initialImageId?: string | null;
    // Fired immediately whenever a new mask is decoded — auto-confirms without button press
    onMaskChange: (maskUrl: string, imageUrl: string, points: SegmentPoint[], imageId: string | null) => void;
    onConfirm: (maskUrl: string | null, imageUrl: string, points: SegmentPoint[], imageId: string | null) => void;
    // Called on every close path (X, Escape, backdrop) so state is never lost
    onClose: (maskUrl: string | null, points: SegmentPoint[], imageId: string | null) => void;
}

export default function SegmentationModal({
    imageUrl: initialImageUrl,
    initialPoints = [],
    initialMaskUrl = null,
    initialImageId = null,
    onMaskChange,
    onConfirm,
    onClose,
}: SegmentationModalProps) {
    const imageRef = useRef<HTMLImageElement>(null);

    const [currentImageUrl] = useState(initialImageUrl);
    const [points, setPoints] = useState<SegmentPoint[]>(initialPoints);
    const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
    const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);

    // SAM3 state — restore imageId from previous session if available
    const [imageId, setImageId] = useState<string | null>(initialImageId);
    const [encoding, setEncoding] = useState(false);
    const [segmentLoading, setSegmentLoading] = useState(false);
    const [maskUrl, setMaskUrl] = useState<string | null>(initialMaskUrl);
    const [maskTimestamp, setMaskTimestamp] = useState(initialMaskUrl ? Date.now() : 0);
    const [sam3Error, setSam3Error] = useState<string | null>(null);
    const [outlineUrl, setOutlineUrl] = useState<string | null>(null);

    // Derive outline from mask whenever it changes
    useEffect(() => {
        if (!maskUrl) { setOutlineUrl(null); return; }
        let cancelled = false;
        extractMaskOutline(maskUrl, 5).then((url) => {
            if (!cancelled) setOutlineUrl(url);
        }).catch(() => {});
        return () => { cancelled = true; };
    }, [maskUrl, maskTimestamp]);

    // Refs so Escape handler never has stale closure over maskUrl / points / imageId
    const maskUrlRef = useRef(maskUrl);
    const pointsRef = useRef(points);
    const imageIdRef = useRef(imageId);
    useEffect(() => { maskUrlRef.current = maskUrl; }, [maskUrl]);
    useEffect(() => { pointsRef.current = points; }, [points]);
    useEffect(() => { imageIdRef.current = imageId; }, [imageId]);

    // Lock background scroll while modal is open
    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = ''; };
    }, []);

    // Close on Escape — pass current state back so nothing is lost
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose(maskUrlRef.current, pointsRef.current, imageIdRef.current);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const updateImageSize = useCallback(() => {
        if (imageRef.current) {
            const rect = imageRef.current.getBoundingClientRect();
            setImageSize({ width: rect.width, height: rect.height });
            setNaturalSize({ width: imageRef.current.naturalWidth, height: imageRef.current.naturalHeight });
        }
    }, []);

    useEffect(() => {
        window.addEventListener('resize', updateImageSize);
        return () => window.removeEventListener('resize', updateImageSize);
    }, [updateImageSize]);

    // Track whether the user has added/removed points since the modal opened.
    // Prevents decode from firing when imageId first arrives but the mask is already valid.
    const pointsDirty = useRef(initialImageId === null);

    // Encode the image to get an imageId — skipped if we already have one from a prior session.
    // Re-runs if imageId is cleared (e.g. server returned 410 = embedding expired).
    useEffect(() => {
        if (imageId !== null) return; // already have a valid imageId

        let cancelled = false;
        setSam3Error(null);
        setEncoding(true);
        // Don't wipe the existing mask — if this is a re-encode after 410 expiry,
        // the mask is still valid and should stay visible while we get a fresh imageId.

        const encode = async () => {
            try {
                const res = await fetch(currentImageUrl);
                const blob = await res.blob();
                const file = new File([blob], 'furniture.png', { type: blob.type });

                const form = new FormData();
                form.append('image', file);

                const response = await fetch('/api/segment-2d/init', { method: 'POST', body: form });
                const data = await response.json() as { imageId?: string; error?: string };

                if (!cancelled) {
                    if (data.imageId) {
                        setImageId(data.imageId);
                    } else {
                        setSam3Error(data.error ?? 'Failed to prepare image for segmentation.');
                    }
                }
            } catch {
                if (!cancelled) setSam3Error('Could not connect to segmentation service.');
            } finally {
                if (!cancelled) setEncoding(false);
            }
        };

        void encode();
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [imageId]);

    // Decode mask whenever points or imageId change
    useEffect(() => {
        if (points.length === 0) {
            setMaskUrl(null);
            return;
        }
        if (!imageId) return;
        // If the user hasn't changed points, the existing mask is still valid — skip decode
        if (!pointsDirty.current) return;

        const controller = new AbortController();
        setSegmentLoading(true);

        const decode = async () => {
            try {
                const response = await fetch('/api/segment-2d', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ imageId, points }),
                    signal: controller.signal,
                });

                if (!response.ok) {
                    if (response.status === 410) {
                        // Embedding expired on server — clearing imageId triggers re-encode
                        setImageId(null);
                        pointsDirty.current = true;
                    }
                    return;
                }

                const blob = await response.blob();
                const reader = new FileReader();
                reader.onload = () => {
                    const newMask = reader.result as string;
                    setMaskUrl(newMask);
                    setMaskTimestamp(Date.now());
                    onMaskChange(newMask, currentImageUrl, points, imageId);
                };
                reader.readAsDataURL(blob);
            } catch (err) {
                if ((err as Error).name !== 'AbortError') {
                    console.error('[SAM3] decode error:', err);
                }
            } finally {
                setSegmentLoading(false);
            }
        };

        void decode();
        return () => controller.abort();
    }, [imageId, points]);

    const [clickMode, setClickMode] = useState<'add' | 'remove'>('add');

    // Convert display-space click → natural image coords
    const handleClick = useCallback((e: MouseEvent<HTMLDivElement>) => {
        if (encoding) return;

        const img = imageRef.current;
        if (!img) return;

        const rect = img.getBoundingClientRect();
        const displayX = e.clientX - rect.left;
        const displayY = e.clientY - rect.top;

        if (displayX < 0 || displayY < 0 || displayX > rect.width || displayY > rect.height) return;

        const x = Math.round((displayX / rect.width) * img.naturalWidth);
        const y = Math.round((displayY / rect.height) * img.naturalHeight);
        const label: 1 | 0 = e.button === 2 ? 0 : (clickMode === 'add' ? 1 : 0);

        pointsDirty.current = true;
        setPoints(prev => [...prev, { x, y, label }]);
    }, [encoding, clickMode]);

    const handleContextMenu = (e: MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        handleClick(e);
    };

    const getDisplayCoords = (point: SegmentPoint) => {
        if (!imageSize || !naturalSize) return { left: 0, top: 0 };
        return {
            left: (point.x / naturalSize.width) * imageSize.width,
            top: (point.y / naturalSize.height) * imageSize.height,
        };
    };

    const handleUndo = () => { pointsDirty.current = true; setPoints(prev => prev.slice(0, -1)); };
    const handleReset = () => { pointsDirty.current = true; setPoints([]); setMaskUrl(null); };

    const canvasClass = 'cursor-crosshair';

    return createPortal(
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={() => onClose(maskUrl, points, imageId)}
        >
            <div
                className="relative flex flex-col bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
                    <div>
                        <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
                            Segment Furniture
                        </h2>
                        <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
                            Click on the furniture to build your selection
                        </p>
                    </div>
                    <button
                        onClick={() => onClose(maskUrl, points, imageId)}
                        className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                        aria-label="Close"
                    >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Canvas area */}
                <div className="flex-1 overflow-auto p-4">
                    {sam3Error && (
                        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600 dark:bg-red-950/30 dark:text-red-400">
                            {sam3Error}
                        </p>
                    )}
                    <div
                        className={`relative overflow-hidden rounded-xl bg-zinc-100 dark:bg-zinc-800 select-none ${canvasClass}`}
                        onClick={handleClick}
                        onContextMenu={handleContextMenu}
                    >
                        <img
                            ref={imageRef}
                            src={currentImageUrl}
                            alt="Furniture to segment"
                            className="block h-auto w-full"
                            onLoad={updateImageSize}
                            draggable={false}
                        />

                        {/* Full encoding overlay — only shown on first encode when there's no mask yet */}
                        {encoding && !maskUrl && (
                            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-black/40 backdrop-blur-[2px]">
                                <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-white/30 border-t-white" />
                                <span className="text-xs font-medium text-white/80">Preparing image…</span>
                            </div>
                        )}
                        {/* Subtle re-encode indicator — shown when session expired but mask is still visible */}
                        {encoding && maskUrl && (
                            <div className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1">
                                <div className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-white/30 border-t-white" />
                                <span className="text-[10px] font-medium text-white/70">Reconnecting…</span>
                            </div>
                        )}

                        {/* Green mask overlay */}
                        {maskUrl && (
                            <div
                                key={maskTimestamp}
                                className="pointer-events-none absolute inset-0"
                                style={{
                                    backgroundColor: 'rgba(34, 197, 94, 0.45)',
                                    maskImage: `url(${maskUrl})`,
                                    WebkitMaskImage: `url(${maskUrl})`,
                                    maskSize: '100% 100%',
                                    WebkitMaskSize: '100% 100%',
                                    maskRepeat: 'no-repeat',
                                    WebkitMaskRepeat: 'no-repeat',
                                    maskMode: 'luminance',
                                    WebkitMaskMode: 'luminance',
                                } as React.CSSProperties}
                            />
                        )}

                        {/* Outline border around the mask */}
                        {outlineUrl && (
                            <img
                                src={outlineUrl}
                                alt=""
                                className="pointer-events-none absolute inset-0 h-full w-full"
                                draggable={false}
                            />
                        )}

                        {/* Click point markers */}
                        {imageSize && naturalSize && points.map((point, i) => {
                            const { left, top } = getDisplayCoords(point);
                            const isLast = i === points.length - 1;
                            const isLoading = isLast && segmentLoading;
                            const isGreen = point.label === 1;

                            return (
                                <div
                                    key={i}
                                    className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2"
                                    style={{ left, top }}
                                >
                                    {isLoading && (
                                        <div className={`absolute -inset-1.5 animate-spin rounded-full border-2 border-transparent ${
                                            isGreen ? 'border-t-green-400' : 'border-t-red-400'
                                        }`} />
                                    )}
                                    <div className={`flex h-5 w-5 items-center justify-center rounded-full border-2 border-white shadow-md ${
                                        isGreen ? 'bg-green-500' : 'bg-red-500'
                                    }`}>
                                        {isGreen ? (
                                            <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" />
                                            </svg>
                                        ) : (
                                            <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M4 12h16" />
                                            </svg>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between gap-3 border-t border-zinc-200 bg-zinc-50 px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
                    {/* Left: Add / Remove toggle */}
                    <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                            Edit mask
                        </span>
                        <div className="flex items-center rounded-full bg-zinc-200/70 p-0.5 dark:bg-zinc-800">
                            <button
                                onClick={() => setClickMode('add')}
                                className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-all duration-150 ${
                                    clickMode === 'add'
                                        ? 'bg-green-500 text-white shadow-sm'
                                        : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
                                }`}
                            >
                                Add
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                    <circle cx="12" cy="12" r="9" />
                                    <path strokeLinecap="round" d="M12 8v8M8 12h8" />
                                </svg>
                            </button>
                            <button
                                onClick={() => setClickMode('remove')}
                                className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-all duration-150 ${
                                    clickMode === 'remove'
                                        ? 'bg-red-500 text-white shadow-sm'
                                        : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
                                }`}
                            >
                                Remove
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                    <circle cx="12" cy="12" r="9" />
                                    <path strokeLinecap="round" d="M8 12h8" />
                                </svg>
                            </button>
                        </div>
                        {points.length > 0 && (
                            <span className="text-xs text-zinc-400 dark:text-zinc-500">
                                {points.length} point{points.length !== 1 ? 's' : ''}
                            </span>
                        )}
                    </div>

                    {/* Right: Undo / Reset / Confirm */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleUndo}
                            disabled={points.length === 0}
                            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                        >
                            Undo
                        </button>
                        <button
                            onClick={handleReset}
                            disabled={points.length === 0}
                            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                        >
                            Reset
                        </button>
                        <button
                            onClick={() => onConfirm(maskUrl, currentImageUrl, points, imageId)}
                            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 active:bg-blue-800"
                        >
                            Confirm Selection
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
