'use client';

import { useEffect, useState } from 'react';
import { useAppActions, useAppStore } from '@/store/useAppStore';
import { SegmentPoint } from '@/types';
import SegmentationModal from '../SegmentationModal';
import LabeledSlider from './LabeledSlider';

export default function RemoveModePanel() {
  const roomImage = useAppStore((state) => state.roomImage);
  const removeMask = useAppStore((state) => state.removeMask);
  const numberOfImages = useAppStore((state) => state.numberOfImages);
  const { setRemoveMask, setNumberOfImages } = useAppActions();

  const [showModal, setShowModal] = useState(false);
  const [savedPoints, setSavedPoints] = useState<SegmentPoint[]>([]);
  const [savedImageId, setSavedImageId] = useState<string | null>(null);

  useEffect(() => {
    setSavedPoints([]);
    setSavedImageId(null);
  }, [roomImage]);

  const handleMaskChange = (_maskUrl: string, _imageUrl: string, points: SegmentPoint[], imageId: string | null) => {
    setRemoveMask(_maskUrl);
    setSavedPoints(points);
    setSavedImageId(imageId);
  };

  const handleClose = (maskUrl: string | null, points: SegmentPoint[], imageId: string | null) => {
    setSavedPoints(points);
    setSavedImageId(imageId);
    if (!maskUrl) setRemoveMask(null);
    setShowModal(false);
  };

  const handleConfirm = (_maskUrl: string | null, _imageUrl: string, points: SegmentPoint[], imageId: string | null) => {
    setSavedPoints(points);
    setSavedImageId(imageId);
    setShowModal(false);
  };

  return (
    <div className="flex h-full w-full flex-col gap-5 px-1">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Upload your room, then select furniture to remove.
        </p>

        <button
          onClick={() => setShowModal(true)}
          disabled={!roomImage}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {removeMask ? 'Edit Remove Selection' : 'Select Furniture to Remove'}
        </button>

        <button
          onClick={() => setRemoveMask(null)}
          disabled={!removeMask}
          className="rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Clear Selection
        </button>

        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {removeMask ? 'Selection ready.' : 'No selection yet.'}
        </p>
      </div>

      <LabeledSlider
        label="Number of Images"
        value={numberOfImages}
        min={1}
        max={6}
        onChange={setNumberOfImages}
      />

      {showModal && roomImage && (
        <SegmentationModal
          imageUrl={roomImage}
          initialPoints={savedPoints}
          initialMaskUrl={removeMask}
          initialImageId={savedImageId}
          onMaskChange={handleMaskChange}
          onConfirm={handleConfirm}
          onClose={handleClose}
        />
      )}
    </div>
  );
}
