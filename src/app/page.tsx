'use client';

import { useEffect, useState } from 'react';
import { useAppStore, useAppActions } from '@/store/useAppStore';
import ControlPanel from '../components/ControlPanel';
import RoomUpload from '../components/RoomUpload';
import ResultsView from '../components/ResultsView';
import PlacementModal from '../components/PlacementModal';
import OnboardingTour from '../components/OnboardingTour';

type RequestState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string };

type TransformApiResponse =
  | { kind: 'ok'; images: Array<{ url: string }> }
  | { kind: 'error'; error: string };

type RemoveFurnitureApiResponse =
  | { kind: 'ok'; images: Array<{ url: string }> }
  | { kind: 'error'; error: string };

function assertNever(value: never): never {
  throw new Error(`Unhandled state: ${String(value)}`);
}

function getErrorMessage(state: RequestState): string | null {
  switch (state.kind) {
    case 'idle':
    case 'loading':
      return null;
    case 'error':
      return state.message;
    default:
      return assertNever(state);
  }
}

export default function Home() {
  const mode = useAppStore((state) => state.mode);
  const roomImage = useAppStore((state) => state.roomImage);
  const roomDepthMap = useAppStore((state) => state.roomDepthMap);
  const referenceImage = useAppStore((state) => state.referenceImage);
  const furnitureMask = useAppStore((state) => state.furnitureMask);
  const removeMask = useAppStore((state) => state.removeMask);
  const glbUrl = useAppStore((state) => state.glbUrl);
  const glbGenerating = useAppStore((state) => state.glbGenerating);
  const glbError = useAppStore((state) => state.glbError);
  const results = useAppStore((state) => state.results);
  const transformStrength = useAppStore((state) => state.transformStrength);
  const numberOfImages = useAppStore((state) => state.numberOfImages);
  const furnitureType = useAppStore((state) => state.furnitureType);

  const { setResults, setRoomImage, setRoomDepthMap, setGlbUrl, setGlbGenerating, setGlbError } = useAppActions();

  const [showPlacement, setShowPlacement] = useState(false);
  const [placementPending, setPlacementPending] = useState(false);
  const [transformState, setTransformState] = useState<RequestState>({ kind: 'idle' });
  const [removeState, setRemoveState] = useState<RequestState>({ kind: 'idle' });
  const canPlace = !!(roomImage && referenceImage && furnitureMask);
  const canTransform = !!(roomImage && referenceImage);
  const canRemove = !!(roomImage && removeMask);
  const placementReady = !!(roomDepthMap && glbUrl);
  const isTransforming = transformState.kind === 'loading';
  const isRemoving = removeState.kind === 'loading';
  const transformError = getErrorMessage(transformState);
  const removeError = getErrorMessage(removeState);

  // Auto-open modal once depth + GLB arrive after the user clicked "Place in Room"
  useEffect(() => {
    if (placementPending && placementReady) {
      setPlacementPending(false);
      setShowPlacement(true);
    }
  }, [placementPending, placementReady]);

  // Fire-and-forget warmup for SAM3 tracker on page load.
  // Wakes the serverless container so segmentation is fast when the user needs it.
  useEffect(() => {
    fetch('/api/segment-2d/warmup', { method: 'POST' }).catch(() => {});
  }, []);

  // Fire-and-forget depth estimation whenever the room image changes.
  // Non-blocking — UI works normally if Modal is cold or unavailable.
  useEffect(() => {
    if (!roomImage) { setRoomDepthMap(null); return; }
    let cancelled = false;
    fetch('/api/depth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: roomImage }),
    })
      .then((r) => r.json())
      .then((data) => { if (!cancelled && data.depthImageUrl) setRoomDepthMap(data.depthImageUrl); })
      .catch(() => {}); // silent fail — depth is background enrichment
    return () => { cancelled = true; };
  }, [roomImage]);

  // Eager 3D generation: start as soon as referenceImage + furnitureMask are available.
  // By the time the user clicks "Place in Room", the GLB may already be ready.
  useEffect(() => {
    if (!referenceImage || !furnitureMask) return;

    const controller = new AbortController();
    setGlbUrl(null);
    setGlbError(null);
    setGlbGenerating(true);

    fetch('/api/generate-3d', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: referenceImage, maskUrl: furnitureMask }),
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) {
          const text = await r.text();
          throw new Error(`Server error ${r.status}: ${text.slice(0, 200)}`);
        }
        return r.json();
      })
      .then((data) => {
        if (data.error) {
          setGlbError(data.error);
        } else if (data.glbUrl) {
          setGlbUrl(data.glbUrl);
        } else {
          setGlbError('No GLB URL returned');
        }
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setGlbError(err.message ?? '3D generation failed');
      })
      .finally(() => {
        if (!controller.signal.aborted) setGlbGenerating(false);
      });

    return () => { controller.abort(); };
  }, [referenceImage, furnitureMask]);

  const handleTransform = async () => {
    if (!roomImage || !referenceImage) return;

    setTransformState({ kind: 'loading' });

    try {
      const response = await fetch('/api/transform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomImageUrl: roomImage,
          referenceImageUrl: referenceImage,
          transformationAmount: transformStrength / 100,
          numImages: numberOfImages,
        }),
      });

      const data = await response.json() as TransformApiResponse;
      if (data.kind === 'error') throw new Error(data.error);
      if (!response.ok) throw new Error('Transform failed');
      if (data.images.length === 0) throw new Error('No images generated');

      setResults(data.images.map((image) => image.url));
      setTransformState({ kind: 'idle' });
    } catch (error) {
      setTransformState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Transform failed',
      });
    }
  };

  const handleRemoveFurniture = async () => {
    if (!roomImage || !removeMask) return;

    setRemoveState({ kind: 'loading' });

    try {
      const response = await fetch('/api/remove-furniture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomImageUrl: roomImage,
          maskUrl: removeMask,
          numImages: numberOfImages,
        }),
      });

      const data = await response.json() as RemoveFurnitureApiResponse;
      if (data.kind === 'error') throw new Error(data.error);
      if (!response.ok) throw new Error('Furniture removal failed');
      if (data.images.length === 0) throw new Error('No images generated');

      setResults(data.images.map((image) => image.url));
      setRemoveState({ kind: 'idle' });
    } catch (error) {
      setRemoveState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Furniture removal failed',
      });
    }
  };

  return (
    <div className="flex h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Left Sidebar - Control Panel */}
      {!results && (
        <ControlPanel />
      )}

      {/* Main Area - conditionally show Upload or Results */}
      <main className="relative flex-1">
        {results ? (
          <ResultsView />
        ) : (
          <>
            {/* Action Buttons - Top Right */}
            <div className="absolute right-6 top-6 z-10 flex items-center gap-3">
              {mode === 'add' && (
                <button
                  data-tour="primary-action"
                  onClick={() => {
                    if (placementReady) {
                      setShowPlacement(true);
                    } else {
                      setPlacementPending(true);
                    }
                  }}
                  disabled={!canPlace || placementPending}
                  className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white shadow-md transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Place in Room
                </button>
              )}
              {mode === 'transform' && (
                <button
                  data-tour="primary-action"
                  onClick={handleTransform}
                  disabled={!canTransform || isTransforming}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-md transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isTransforming ? 'Transforming...' : 'Transform Room'}
                </button>
              )}
              {mode === 'remove' && (
                <button
                  data-tour="primary-action"
                  onClick={handleRemoveFurniture}
                  disabled={!canRemove || isRemoving}
                  className="flex items-center gap-2 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-medium text-white shadow-md transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isRemoving ? 'Removing...' : 'Remove Furniture'}
                </button>
              )}
            </div>

            {mode === 'transform' && transformError && (
              <div className="absolute right-6 top-20 z-10 rounded-md bg-red-100 px-3 py-2 text-xs text-red-700 dark:bg-red-900/40 dark:text-red-300">
                {transformError}
              </div>
            )}
            {mode === 'remove' && removeError && (
              <div className="absolute right-6 top-20 z-10 rounded-md bg-red-100 px-3 py-2 text-xs text-red-700 dark:bg-red-900/40 dark:text-red-300">
                {removeError}
              </div>
            )}

            <RoomUpload image={roomImage} onImageChange={setRoomImage} />

            {/* Preparing overlay — depth map / 3D model generation */}
            {placementPending && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center overflow-hidden">
                {/* Animated gradient background */}
                <div
                  className="absolute inset-0 opacity-85"
                  style={{
                    background: 'linear-gradient(135deg, #022c22 0%, #064e3b 20%, #0a1628 40%, #065f46 60%, #0d1b2a 80%, #022c22 100%)',
                    backgroundSize: '300% 300%',
                    animation: 'preparing-gradient 6s ease infinite',
                  }}
                />

                {/* Floating X to cancel */}
                <button
                  onClick={() => setPlacementPending(false)}
                  className="absolute right-6 top-6 z-30 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-zinc-400 transition-colors hover:bg-white/20 hover:text-white"
                  aria-label="Cancel"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>

                {/* Center content */}
                <div className="relative z-10 flex flex-col items-center gap-5">
                  {/* 3D cube animation */}
                  <div className="relative h-16 w-16" style={{ perspective: '200px' }}>
                    <div
                      className="h-16 w-16 rounded-xl border-2 border-emerald-400/60"
                      style={{
                        animation: 'preparing-cube 4s linear infinite',
                        transformStyle: 'preserve-3d',
                      }}
                    />
                    {/* Orbiting dot */}
                    <div className="absolute left-1/2 top-1/2 h-0 w-0">
                      <div
                        className="h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]"
                        style={{ animation: 'preparing-orbit 3s linear infinite' }}
                      />
                    </div>
                  </div>

                  {/* Text with glow */}
                  <div className="flex flex-col items-center gap-2">
                    <span
                      className="text-lg font-semibold text-white"
                      style={{ animation: 'preparing-text-glow 2.5s ease-in-out infinite' }}
                    >
                      {!roomDepthMap ? 'Generating depth map' : 'Creating 3D model'}
                    </span>
                    <span className="text-sm text-zinc-400">
                      {!roomDepthMap
                        ? 'Analyzing room perspective and depth'
                        : 'Building a 3D mesh from your furniture'}
                    </span>
                  </div>

                  {/* Animated dots */}
                  <div className="flex items-center gap-2">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className="h-1.5 w-1.5 rounded-full bg-emerald-400"
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
                      background: 'linear-gradient(90deg, transparent, rgba(52, 211, 153, 0.06), transparent)',
                      animation: 'naturalizing-shimmer 3s ease-in-out infinite',
                    }}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* 3D Placement Modal */}
      {showPlacement && roomImage && roomDepthMap && (
        <PlacementModal
          roomImageUrl={roomImage}
          depthImageUrl={roomDepthMap}
          glbUrl={glbUrl}
          glbGenerating={glbGenerating}
          glbError={glbError}
          furnitureType={furnitureType}
          numberOfImages={numberOfImages}
          referenceImageUrl={referenceImage}
          furnitureMaskUrl={furnitureMask}
          onConfirm={(results) => {
            setShowPlacement(false);
            setResults(results);
          }}
          onClose={() => setShowPlacement(false)}
        />
      )}

      <OnboardingTour />
    </div>
  );
}
