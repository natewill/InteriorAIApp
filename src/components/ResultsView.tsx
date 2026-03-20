'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAppStore, useAppActions } from '@/store/useAppStore';
import ImageCarousel from './ImageCarousel';

export default function ResultsView() {
  const results = useAppStore((state) => state.results) || []; // Fallback to empty array if null
  const { setResults, setRoomImage } = useAppActions();

  const handleUseImage = (imageUrl: string) => {
    setRoomImage(imageUrl);
  };

  const handleTryAgain = () => {
    setResults(null);
  };
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
    } else if (e.key === 'ArrowRight') {
      setSelectedIndex((prev) => (prev + 1) % results.length);
    }
  }, [results.length]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleDownload = async () => {
    const imageUrl = results[selectedIndex];
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.download = `interiorai-result-${selectedIndex + 1}-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      URL.revokeObjectURL(url);
    } catch {
      window.open(imageUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div data-tour="results-view" className="relative flex h-full w-full flex-col">
      <div className="absolute left-6 top-6 z-20">
        <button
          onClick={handleTryAgain}
          className="rounded-lg border border-zinc-300 bg-white/90 px-4 py-2 text-sm font-medium text-zinc-700 shadow-md transition-all hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-900/90 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Try Again
        </button>
      </div>

      <div className="absolute right-6 top-6 z-20 flex items-center gap-3">
        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white/90 px-4 py-2 text-sm font-medium text-zinc-700 shadow-md transition-all hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-900/90 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
          Download
        </button>
        <button
          onClick={() => handleUseImage(results[selectedIndex])}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-md shadow-blue-500/20 transition-all hover:bg-blue-700 hover:shadow-blue-500/30"
        >
          Edit This Image
        </button>
      </div>

      {/* Carousel Area */}
      <div className="flex-1">
        <ImageCarousel
          images={results}
          selectedIndex={selectedIndex}
          onSelect={setSelectedIndex}
        />
      </div>
    </div>
  );
}
