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

interface PlacementGuideStep {
    title: string;
    description: string;
    selector: string;
}

type PlacementGuideState =
    | { kind: 'closed' }
    | { kind: 'open'; stepIndex: number };

const PLACEMENT_GUIDE_STEPS: PlacementGuideStep[] = [
    {
        title: 'Move furniture in the scene',
        description: 'Click and drag in the scene to place the furniture where you want it. Scroll to zoom in and get the position feeling right.',
        selector: '[data-placement-guide="scene"]',
    },
    {
        title: 'Tune the placement',
        description: 'Use these controls to make the piece feel natural in the room. Adjust the size, move it forward or back, and rotate it until it sits right.',
        selector: '[data-placement-guide="controls"]',
    },
    {
        title: 'Generate the final image',
        description: 'When the placement looks good, click Generate. We will blend it into the room with more realistic lighting, depth, and shadows.',
        selector: '[data-placement-guide="generate"]',
    },
];

function isValidImageUrl(value: string): boolean {
    return value.startsWith('data:image/') || value.startsWith('https://');
}

function normalizeGenerateError(message: string): string {
    const normalized = message.toLowerCase();

    if (
        normalized.includes('the string did not match the expected pattern') ||
        normalized.includes('unable to process input image') ||
        normalized.includes('fetch failed')
    ) {
        return 'Image generation failed for this scene. Please adjust placement or retry.';
    }

    if (
        normalized.includes('unregistered callers') ||
        normalized.includes('api key')
    ) {
        return 'Image generation is unavailable right now. Please check server API key configuration.';
    }

    return message;
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
    const [guideState, setGuideState] = useState<PlacementGuideState>({ kind: 'closed' });
    const [guideRect, setGuideRect] = useState<DOMRect | null>(null);
    const [hasAutoOpenedGuide, setHasAutoOpenedGuide] = useState(false);
    const [viewport, setViewport] = useState({ width: 1200, height: 800 });

    // Lock background scroll
    useEffect(() => {
        document.body.style.overflow = 'hidden';
        setViewport({ width: window.innerWidth, height: window.innerHeight });
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
            let compositeImageUrl = '';
            let maskImageUrl = '';

            try {
                [compositeImageUrl, maskImageUrl] = await Promise.all([
                    scene.captureComposite(),
                    scene.captureMask(),
                ]);
            } catch (error) {
                throw new Error(error instanceof Error ? `Could not capture scene: ${error.message}` : 'Could not capture scene');
            }

            if (!isValidImageUrl(compositeImageUrl)) {
                throw new Error('Scene capture returned an invalid composite image');
            }

            if (!isValidImageUrl(maskImageUrl)) {
                throw new Error('Scene capture returned an invalid mask image');
            }

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

            const data = await res.json() as { error?: string; images?: Array<{ url?: string }> };

            if (!res.ok) {
                throw new Error(normalizeGenerateError(data.error || `Server error ${res.status}`));
            }

            if (!data.images || data.images.length === 0) {
                throw new Error('No images were generated');
            }

            const resultUrls = data.images
                .map((image) => image.url)
                .filter((url): url is string => typeof url === 'string' && isValidImageUrl(url));

            if (resultUrls.length === 0) {
                throw new Error('Naturalize returned invalid image URLs');
            }

            onConfirm(resultUrls);
        } catch (err) {
            console.error('Generation failed:', err);
            const message = err instanceof Error ? err.message : 'Generation failed';
            setGenerateError(normalizeGenerateError(message));
        } finally {
            setGenerating(false);
        }
    }, [scene, onConfirm, furnitureType, numberOfImages, referenceImageUrl, furnitureMaskUrl]);

    const sceneReady = !!glbUrl && !scene.loading && !scene.error;

    useEffect(() => {
        if (!sceneReady || hasAutoOpenedGuide) {
            return;
        }
        setHasAutoOpenedGuide(true);
        setGuideState({ kind: 'open', stepIndex: 0 });
    }, [sceneReady, hasAutoOpenedGuide]);

    useEffect(() => {
        if (guideState.kind !== 'open') {
            setGuideRect(null);
            return;
        }

        const step = PLACEMENT_GUIDE_STEPS[guideState.stepIndex];
        const updateRect = () => {
            setViewport({ width: window.innerWidth, height: window.innerHeight });
            const target = document.querySelector(step.selector);
            if (!(target instanceof HTMLElement)) {
                setGuideRect(null);
                return;
            }
            setGuideRect(target.getBoundingClientRect());
        };

        updateRect();
        window.addEventListener('resize', updateRect);
        window.addEventListener('scroll', updateRect, true);
        return () => {
            window.removeEventListener('resize', updateRect);
            window.removeEventListener('scroll', updateRect, true);
        };
    }, [guideState]);

    const openGuide = () => {
        setGuideState({ kind: 'open', stepIndex: 0 });
    };

    const closeGuide = () => {
        setGuideState({ kind: 'closed' });
    };

    const goBackGuide = () => {
        if (guideState.kind !== 'open') {
            return;
        }
        if (guideState.stepIndex === 0) {
            return;
        }
        setGuideState({ kind: 'open', stepIndex: guideState.stepIndex - 1 });
    };

    const goNextGuide = () => {
        if (guideState.kind !== 'open') {
            return;
        }
        const isLast = guideState.stepIndex === PLACEMENT_GUIDE_STEPS.length - 1;
        if (isLast) {
            closeGuide();
            return;
        }
        setGuideState({ kind: 'open', stepIndex: guideState.stepIndex + 1 });
    };

    const guideOpen = guideState.kind === 'open';
    const guideStep = guideOpen ? PLACEMENT_GUIDE_STEPS[guideState.stepIndex] : null;
    const canGoBack = guideOpen && guideState.stepIndex > 0;
    const canGoNext = guideOpen && guideState.stepIndex < PLACEMENT_GUIDE_STEPS.length - 1;
    const guideCardLeft = guideRect ? Math.min(Math.max(guideRect.left, 16), viewport.width - 376) : 16;
    const guideCardTop = guideRect
        ? Math.max(16, Math.min(guideRect.bottom + 12, viewport.height - 208))
        : 16;

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
                        data-placement-guide="scene"
                        className="relative h-full w-full"
                        style={{ visibility: sceneReady ? 'visible' : 'hidden' }}
                    />
                </div>

                {/* Footer controls — hidden during generation */}
                {sceneReady && !generating && (
                    <div className="flex flex-wrap items-center justify-between gap-5 border-t border-white/20 bg-black/80 px-6 py-5 backdrop-blur-md">
                        {/* Left: sliders */}
                        <div data-placement-guide="controls" className="flex flex-wrap items-center gap-4">
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
                            <button
                                type="button"
                                onClick={openGuide}
                                className="rounded-xl border border-white/25 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/10"
                            >
                                Guide
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
                                data-placement-guide="generate"
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

                {guideOpen && guideStep && (
                    <>
                        <div className="fixed inset-0 z-[70] bg-black/55" onClick={closeGuide} />
                        {guideRect && (
                            <div
                                className="pointer-events-none fixed z-[80] rounded-xl border-2 border-blue-400 shadow-[0_0_0_2px_rgba(96,165,250,0.45)]"
                                style={{
                                    top: Math.max(6, guideRect.top - 6),
                                    left: Math.max(6, guideRect.left - 6),
                                    width: guideRect.width + 12,
                                    height: guideRect.height + 12,
                                }}
                            />
                        )}
                        <section
                            className="fixed z-[90] w-[360px] max-w-[calc(100vw-32px)] rounded-xl border border-zinc-700 bg-zinc-900 p-4 text-zinc-100 shadow-2xl"
                            style={{ top: guideCardTop, left: guideCardLeft }}
                        >
                            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                                3D guide · step {guideState.kind === 'open' ? guideState.stepIndex + 1 : 1}/{PLACEMENT_GUIDE_STEPS.length}
                            </div>
                            <h3 className="text-base font-semibold text-white">{guideStep.title}</h3>
                            <p className="mt-1 text-sm text-zinc-300">{guideStep.description}</p>
                            <div className="mt-4 flex items-center justify-between gap-2">
                                <button
                                    type="button"
                                    onClick={goBackGuide}
                                    disabled={!canGoBack}
                                    className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 disabled:opacity-45"
                                >
                                    Back
                                </button>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={closeGuide}
                                        className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300"
                                    >
                                        Close
                                    </button>
                                    <button
                                        type="button"
                                        onClick={goNextGuide}
                                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                                    >
                                        {canGoNext ? 'Next' : 'Done'}
                                    </button>
                                </div>
                            </div>
                        </section>
                    </>
                )}
            </div>
        </div>,
        document.body
    );
}
