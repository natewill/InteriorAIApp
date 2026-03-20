'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { usePlacementScene } from './placement/usePlacementScene';

interface PlacementModalProps {
    roomImageUrl: string;
    depthImageUrl: string;
    glbUrl: string | null;
    glbGenerating: boolean;
    glbError: string | null;
    furnitureType: string;
    numberOfImages: number;
    referenceImageUrl: string | null;
    furnitureMaskUrl: string | null;
    onConfirm: (results: string[]) => void;
    onClose: () => void;
}

export default function PlacementModal({
    roomImageUrl,
    depthImageUrl,
    glbUrl,
    glbGenerating,
    glbError,
    furnitureType,
    numberOfImages,
    referenceImageUrl,
    furnitureMaskUrl,
    onConfirm,
    onClose,
}: PlacementModalProps) {
    const containerRef = useRef<HTMLDivElement>(null!);

    // Scene controls
    const [scaleFactor, setScaleFactor] = useState(1);
    const [depthOffset, setDepthOffset] = useState(0);
    const [showRotateGizmo, setShowRotateGizmo] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [generateError, setGenerateError] = useState<string | null>(null);

    // Lock background scroll
    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = ''; };
    }, []);

    // Close on Escape
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    // Three.js scene — only active once glbUrl is available
    const scene = usePlacementScene({
        containerRef,
        roomImageUrl,
        depthImageUrl,
        glbUrl: glbUrl ?? '',
        scaleFactor,
        depthOffset,
        showRotateGizmo,
    });

    const handleGenerate = useCallback(async () => {
        setGenerating(true);
        setGenerateError(null);

        // Yield a frame so the browser paints the loading state
        // before Three.js capture blocks the main thread
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        try {
            const [compositeImageUrl, maskImageUrl] = await Promise.all([
                scene.captureComposite(),
                scene.captureMask(),
            ]);

            const res = await fetch('/api/naturalize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    compositeImageUrl,
                    maskImageUrl,
                    furnitureType,
                    numberOfImages,
                    referenceImageUrl,
                    furnitureMaskUrl,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || `Server error ${res.status}`);
            }

            if (!data.images || data.images.length === 0) {
                throw new Error('No images were generated');
            }

            onConfirm(data.images.map((img: { url: string }) => img.url));
        } catch (err) {
            console.error('Generation failed:', err);
            setGenerateError(err instanceof Error ? err.message : 'Generation failed');
        } finally {
            setGenerating(false);
        }
    }, [scene, onConfirm, furnitureType, numberOfImages, referenceImageUrl, furnitureMaskUrl]);

    const sceneReady = !!glbUrl && !scene.loading && !scene.error;

    return createPortal(
        <div
            className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="flex h-full w-full flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header — hidden during generation, X button stays */}
                {!generating && (
                    <div className="flex items-center justify-between px-6 py-4">
                        <div>
                            <h2 className="text-lg font-semibold text-white">
                                Place Furniture
                            </h2>
                            <p className="mt-0.5 text-sm text-zinc-400">
                                Drag to move, scroll to zoom, adjust controls below
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-zinc-400 transition-colors hover:bg-white/20 hover:text-white"
                            aria-label="Close"
                        >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                )}
                {/* Floating X when generating */}
                {generating && (
                    <button
                        onClick={onClose}
                        className="absolute right-6 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-zinc-400 transition-colors hover:bg-white/20 hover:text-white"
                        aria-label="Close"
                    >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                )}

                {/* Canvas area */}
                <div className="relative flex-1 overflow-hidden">
                    {/* Loading overlays */}
                    {(glbGenerating || (glbUrl && scene.loading)) && (
                        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
                            <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-white/20 border-t-white" />
                            <span className="text-sm font-medium text-white/80">
                                {glbGenerating ? 'Generating 3D model...' : 'Loading scene...'}
                            </span>
                        </div>
                    )}

                    {/* Naturalization overlay — flashy version */}
                    {generating && (
                        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center overflow-hidden">
                            {/* Animated gradient background */}
                            <div
                                className="absolute inset-0 opacity-80"
                                style={{
                                    background: 'linear-gradient(135deg, #0f0a1e 0%, #1a1035 20%, #0d1b2a 40%, #1a0a2e 60%, #0a1628 80%, #0f0a1e 100%)',
                                    backgroundSize: '300% 300%',
                                    animation: 'naturalizing-gradient 6s ease infinite',
                                }}
                            />

                            {/* Center content */}
                            <div className="relative z-10 flex flex-col items-center gap-5">
                                {/* Sparkle icon */}
                                <div className="relative">
                                    <svg className="h-10 w-10 text-violet-400 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M12 2L9.19 8.63L2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2z" />
                                    </svg>
                                </div>

                                {/* Text with glow */}
                                <div className="flex flex-col items-center gap-2">
                                    <span
                                        className="text-lg font-semibold text-white"
                                        style={{ animation: 'naturalizing-text-glow 2.5s ease-in-out infinite' }}
                                    >
                                        Generating final image!
                                    </span>
                                    <span className="text-sm text-zinc-400">
                                        Blending lighting, shadows & perspective
                                    </span>
                                </div>

                                {/* Animated dots row */}
                                <div className="flex items-center gap-2">
                                    {[0, 1, 2, 3, 4].map((i) => (
                                        <div
                                            key={i}
                                            className="h-1.5 w-1.5 rounded-full bg-violet-400"
                                            style={{ animation: `naturalizing-dot 1.4s ease-in-out ${i * 0.15}s infinite` }}
                                        />
                                    ))}
                                </div>

                                <span className="mt-2 text-xs text-zinc-500">
                                    This may take a minute
                                </span>
                            </div>

                            {/* Shimmer sweep */}
                            <div className="pointer-events-none absolute inset-0 overflow-hidden">
                                <div
                                    className="absolute inset-y-0 w-1/3"
                                    style={{
                                        background: 'linear-gradient(90deg, transparent, rgba(139, 92, 246, 0.06), transparent)',
                                        animation: 'naturalizing-shimmer 3s ease-in-out infinite',
                                    }}
                                />
                            </div>
                        </div>
                    )}
                    {(glbError || scene.error || generateError) && (
                        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 px-8">
                            <div className="rounded-xl bg-red-950/60 px-6 py-4 text-center">
                                <p className="text-sm font-medium text-red-300">
                                    {glbError || scene.error || generateError}
                                </p>
                                <button
                                    onClick={() => {
                                        if (generateError) setGenerateError(null);
                                        else onClose();
                                    }}
                                    className="mt-3 rounded-lg bg-white/10 px-4 py-1.5 text-sm text-white transition-colors hover:bg-white/20"
                                >
                                    {generateError ? 'Dismiss' : 'Close'}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Three.js container — always mounted so ref is stable, hidden until ready */}
                    <div
                        ref={containerRef}
                        className="relative h-full w-full"
                        style={{ visibility: sceneReady ? 'visible' : 'hidden' }}
                    />
                </div>

                {/* Footer controls — hidden during generation */}
                {sceneReady && !generating && (
                    <div className="flex flex-wrap items-center justify-between gap-5 border-t border-white/20 bg-black/80 px-6 py-5 backdrop-blur-md">
                        {/* Left: sliders */}
                        <div className="flex flex-wrap items-center gap-4">
                            <label className="flex items-center gap-2 text-base text-zinc-200">
                                Scale
                                <input
                                    type="range"
                                    min="0.1"
                                    max="3"
                                    step="0.05"
                                    value={scaleFactor}
                                    onChange={(e) => setScaleFactor(parseFloat(e.target.value))}
                                    className="w-36 accent-blue-500"
                                />
                                <span className="w-10 text-sm text-zinc-300">{scaleFactor.toFixed(1)}</span>
                            </label>
                            <label className="flex items-center gap-2 text-base text-zinc-200">
                                Depth
                                <input
                                    type="range"
                                    min="-1"
                                    max="1"
                                    step="0.05"
                                    value={depthOffset}
                                    onChange={(e) => setDepthOffset(parseFloat(e.target.value))}
                                    className="w-36 accent-blue-500"
                                />
                                <span className="w-10 text-sm text-zinc-300">{depthOffset.toFixed(1)}</span>
                            </label>
                            <button
                                onClick={() => setShowRotateGizmo((v) => !v)}
                                className={`rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
                                    showRotateGizmo
                                        ? 'border-blue-400/70 bg-blue-500/30 text-blue-100'
                                        : 'border-white/25 bg-white/5 text-zinc-200 hover:bg-white/10'
                                }`}
                            >
                                <span className="flex items-center gap-2">
                                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M20 7l-8-4-8 4m16 0v10l-8 4m8-14l-8 4m0 10l-8-4V7m8 14V11m0 0L4 7m8 4l8-4"
                                        />
                                    </svg>
                                    Rotate furntiure
                                </span>
                            </button>
                        </div>

                        {/* Right: action buttons */}
                        <div className="flex items-center gap-3">
                            <button
                                onClick={scene.reset}
                                disabled={generating}
                                className="rounded-xl border border-white/25 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:bg-white/10 disabled:opacity-50"
                            >
                                Reset
                            </button>
                            <button
                                onClick={handleGenerate}
                                disabled={generating}
                                className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                            >
                                {generating && (
                                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                                )}
                                {generating ? 'Generating...' : 'Generate'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
}
