'use client';

import { useState, useEffect, useRef } from 'react';
import { useAppStore, useAppActions } from '@/store/useAppStore';
import { SegmentPoint } from '@/types';
import ImageUpload from '../ImageUpload';
import LabeledSlider from './LabeledSlider';
import SegmentationModal from '../SegmentationModal';

const furnitureTypes = [
  'Chair',
  'Sofa',
  'Table',
  'Bed',
  'Lamp',
  'Desk',
  'Shelf',
  'Rug',
  'Plant',
  'Other',
];

// Bake image + green mask into a single data URL so the thumbnail
// displays the composited result without any scaling mismatch.
async function compositeSegmentation(imageUrl: string, maskUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);

      const maskImg = new Image();
      maskImg.onload = () => {
        // Draw mask to read its pixel data
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = w;
        maskCanvas.height = h;
        const maskCtx = maskCanvas.getContext('2d')!;
        maskCtx.drawImage(maskImg, 0, 0, w, h);

        const imageData = ctx.getImageData(0, 0, w, h);
        const maskPixels = maskCtx.getImageData(0, 0, w, h).data;

        const isMask = (x: number, y: number) => {
          if (x < 0 || y < 0 || x >= w || y >= h) return false;
          return maskPixels[(y * w + x) * 4] > 128;
        };

        // Flood-fill from edges to find exterior background
        const exterior = new Uint8Array(w * h);
        const queue: number[] = [];
        for (let x = 0; x < w; x++) {
          if (!isMask(x, 0))     queue.push(0 * w + x);
          if (!isMask(x, h - 1)) queue.push((h - 1) * w + x);
        }
        for (let y = 1; y < h - 1; y++) {
          if (!isMask(0, y))     queue.push(y * w + 0);
          if (!isMask(w - 1, y)) queue.push(y * w + (w - 1));
        }
        for (const idx of queue) exterior[idx] = 1;

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

        const borderThickness = 5;

        // Blend green fill + solid green outline (perimeter only)
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            if (!isMask(x, y)) continue;

            let nearExterior = false;
            for (let dy = -borderThickness; dy <= borderThickness && !nearExterior; dy++) {
              for (let dx = -borderThickness; dx <= borderThickness && !nearExterior; dx++) {
                if (dx === 0 && dy === 0) continue;
                if (isExterior(x + dx, y + dy)) nearExterior = true;
              }
            }

            if (nearExterior) {
              const a = 0.9;
              imageData.data[i]     = Math.round(imageData.data[i]     * (1 - a) + 34  * a);
              imageData.data[i + 1] = Math.round(imageData.data[i + 1] * (1 - a) + 197 * a);
              imageData.data[i + 2] = Math.round(imageData.data[i + 2] * (1 - a) + 94  * a);
            } else {
              const a = 0.45;
              imageData.data[i]     = Math.round(imageData.data[i]     * (1 - a) + 34  * a);
              imageData.data[i + 1] = Math.round(imageData.data[i + 1] * (1 - a) + 197 * a);
              imageData.data[i + 2] = Math.round(imageData.data[i + 2] * (1 - a) + 94  * a);
            }
          }
        }

        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      };
      maskImg.onerror = reject;
      maskImg.src = maskUrl;
    };
    img.onerror = reject;
    img.src = imageUrl;
  });
}

export default function AddModePanel() {
  const referenceImage = useAppStore((state) => state.referenceImage);
  const furnitureMask = useAppStore((state) => state.furnitureMask);
  const furnitureType = useAppStore((state) => state.furnitureType);
  const numberOfImages = useAppStore((state) => state.numberOfImages);

  const { setReferenceImage, setFurnitureMask, setFurnitureType, setNumberOfImages } = useAppActions();

  const [showModal, setShowModal] = useState(false);
  const [encoding, setEncoding] = useState(false);
  const [encodeError, setEncodeError] = useState(false);
  const [segmentedPreview, setSegmentedPreview] = useState<string | null>(null);
  const [savedPoints, setSavedPoints] = useState<SegmentPoint[]>([]);
  const [savedMask, setSavedMask] = useState<string | null>(null);
  const [savedImageId, setSavedImageId] = useState<string | null>(null);

  // When set to true, the modal opens automatically once encoding finishes
  const openOnEncodeRef = useRef(false);

  // Rebuild segmented preview on mount when store already has mask data
  // (e.g. returning from ResultsView via "Try Again")
  useEffect(() => {
    if (referenceImage && furnitureMask && !segmentedPreview) {
      compositeSegmentation(referenceImage, furnitureMask)
        .then(setSegmentedPreview)
        .catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Encode the image as soon as it's uploaded — spinner shows in sidebar,
  // modal opens automatically once imageId is ready.
  useEffect(() => {
    if (!referenceImage) return;
    if (savedImageId) return; // already encoded for this image

    let cancelled = false;
    setEncoding(true);
    setEncodeError(false);

    const encode = async () => {
      try {
        const res = await fetch(referenceImage);
        const blob = await res.blob();
        const file = new File([blob], 'furniture.png', { type: blob.type });
        const form = new FormData();
        form.append('image', file);

        const response = await fetch('/api/segment-2d/init', { method: 'POST', body: form });
        const data = await response.json() as { imageId?: string; error?: string };

        if (!cancelled) {
          if (data.imageId) {
            setSavedImageId(data.imageId);
            if (openOnEncodeRef.current) {
              openOnEncodeRef.current = false;
              setShowModal(true);
            }
          } else {
            setEncodeError(true);
            openOnEncodeRef.current = false;
          }
        }
      } catch {
        if (!cancelled) {
          setEncodeError(true);
          openOnEncodeRef.current = false;
        }
      } finally {
        if (!cancelled) setEncoding(false);
      }
    };

    void encode();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceImage]);

  const handleFurnitureImageChange = (image: string | null) => {
    setReferenceImage(image);
    setSegmentedPreview(null);
    setSavedPoints([]);
    setSavedMask(null);
    setSavedImageId(null);
    setEncodeError(false);
    if (image) openOnEncodeRef.current = true; // open modal once encode done
  };

  // Fired on every decode — auto-saves mask without requiring Confirm button
  const handleMaskChange = async (maskUrl: string, imageUrl: string, points: SegmentPoint[], imageId: string | null) => {
    setFurnitureMask(maskUrl);
    setSavedMask(maskUrl);
    setSavedPoints(points);
    setSavedImageId(imageId);
    try {
      const preview = await compositeSegmentation(imageUrl, maskUrl);
      setSegmentedPreview(preview);
    } catch {
      setSegmentedPreview(null);
    }
  };

  // Called on every close path — saves remaining state and closes
  const handleModalClose = (maskUrl: string | null, points: SegmentPoint[], imageId: string | null) => {
    setSavedPoints(points);
    setSavedMask(maskUrl);
    setSavedImageId(imageId);
    // If user reset/undid everything, clear the confirmed mask too
    if (!maskUrl) {
      setFurnitureMask(null);
      setSegmentedPreview(null);
    }
    setShowModal(false);
  };

  // Confirm button just closes — mask is already saved via handleMaskChange
  const handleConfirm = (_maskUrl: string | null, _imageUrl: string, points: SegmentPoint[], imageId: string | null) => {
    setSavedPoints(points);
    setSavedImageId(imageId);
    setShowModal(false);
  };

  const isSegmented = furnitureMask !== null;
  const thumbnailSrc = segmentedPreview ?? referenceImage;

  return (
    <div className="flex h-full w-full flex-col gap-5 px-1">
      <div data-tour="furniture-upload" className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Furniture Image
        </label>
        {referenceImage ? (
          <div className="group relative aspect-square overflow-hidden rounded-xl border border-zinc-200 transition-all duration-150 dark:border-zinc-700">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumbnailSrc!}
              alt="Furniture"
              className="h-full w-full object-cover"
            />

            {/* Encoding spinner / error */}
            {(encoding || encodeError) && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 backdrop-blur-[2px]">
                {encoding ? (
                  <>
                    <div className="h-6 w-6 animate-spin rounded-full border-[2.5px] border-white/30 border-t-white" />
                    <span className="text-[11px] font-medium text-white/70">Uploading…</span>
                  </>
                ) : (
                  <>
                    <svg className="h-5 w-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-[11px] font-medium text-white/70">Upload failed</span>
                  </>
                )}
              </div>
            )}

            {/* Segmented checkmark — centered, hidden on hover, hidden while encoding */}
            {isSegmented && !encoding && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity group-hover:opacity-0">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/50 text-green-400">
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </div>
            )}

            {/* Always-visible X button */}
            <button
              onClick={(e) => { e.stopPropagation(); handleFurnitureImageChange(null); }}
              className="absolute right-2 top-2 z-20 rounded-full bg-black/50 p-1.5 text-white transition-colors hover:bg-black/70"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Hover overlay — only shown when not encoding */}
            {!encoding && (
              <div
                className="pointer-events-none absolute inset-0 bg-black/40 opacity-0 backdrop-blur-[2px] transition-opacity group-hover:pointer-events-auto group-hover:opacity-100"
                onClick={() => setShowModal(true)}
              >
                <div className="flex h-full flex-col items-center justify-center">
                  <div className="group/pill flex scale-90 flex-col items-center gap-1.5 rounded-full bg-white/20 px-4 py-2.5 text-white shadow-lg ring-1 ring-white/30 backdrop-blur-md transition-transform group-hover:scale-100 hover:scale-110">
                    <svg className="h-4 w-4 transition-transform group-hover/pill:scale-110" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                    <span className="text-xs font-semibold tracking-wide transition-transform group-hover/pill:scale-105">Edit</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <ImageUpload
            label="Upload furniture"
            image={null}
            onImageChange={handleFurnitureImageChange}
            compact
          />
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Furniture Type
        </label>
        <select
          value={furnitureType}
          onChange={(e) => setFurnitureType(e.target.value)}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
        >
          {furnitureTypes.map((type) => (
            <option key={type} value={type.toLowerCase()}>
              {type}
            </option>
          ))}
        </select>
      </div>
      <LabeledSlider
        label="Number of Images"
        value={numberOfImages}
        min={1}
        max={10}
        onChange={setNumberOfImages}
      />

      {showModal && referenceImage && (
        <SegmentationModal
          imageUrl={referenceImage}
          initialPoints={savedPoints}
          initialMaskUrl={savedMask}
          initialImageId={savedImageId}
          onMaskChange={handleMaskChange}
          onConfirm={handleConfirm}
          onClose={handleModalClose}
        />
      )}
    </div>
  );
}
