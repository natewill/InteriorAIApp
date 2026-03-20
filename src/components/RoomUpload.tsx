'use client';

import { IMAGE_VALIDATION } from '@/lib/imageValidation';
import { useImageUpload } from '@/hooks/useImageUpload';

interface RoomUploadProps {
  image: string | null;
  onImageChange: (image: string | null) => void;
}

export default function RoomUpload({ image, onImageChange }: RoomUploadProps) {
  const {
    isDragging,
    error,
    handleDrop,
    handleDragOver,
    handleDragLeave,
    handleInputChange,
    handleRemove,
    setPasteTarget,
  } = useImageUpload({ onImageChange });

  return (
    <div className="flex h-full w-full items-center justify-center p-8 pt-20">
      <label
        data-tour="room-upload"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onMouseEnter={() => setPasteTarget(true)}
        onMouseLeave={() => setPasteTarget(false)}
        className={`
          relative flex h-full w-full cursor-pointer flex-col items-center justify-center
          rounded-xl border-2 border-dashed transition-all
          ${isDragging
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/20'
            : 'border-zinc-200 bg-zinc-50 hover:border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800/50 dark:hover:border-zinc-600 dark:hover:bg-zinc-800'
          }
          ${image ? 'border-solid border-zinc-200 dark:border-zinc-700' : ''}
        `}
      >
        <input
          type="file"
          accept="image/*"
          onChange={handleInputChange}
          className="absolute inset-0 cursor-pointer opacity-0"
        />

        {image ? (
          <>
            <img
              src={image}
              alt="Room"
              className="absolute inset-0 h-full w-full rounded-xl object-contain p-3"
            />
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={handleRemove}
              className="absolute right-3 top-3 rounded-full bg-black/50 p-1.5 text-white transition-colors hover:bg-black/70"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="rounded-full bg-zinc-100 p-4 dark:bg-zinc-800">
              <svg
                className="h-8 w-8 text-zinc-400 dark:text-zinc-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 22V12h6v10"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-medium text-zinc-700 dark:text-zinc-300">
                Upload Your Room
              </h3>
              <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
                Drag & drop an image or click to browse
              </p>
            </div>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              PNG, JPG, WEBP up to {Math.round(IMAGE_VALIDATION.maxSizeBytes / (1024 * 1024))}MB
            </p>
          </div>
        )}
      </label>
      {error && (
        <p className="mt-3 text-sm font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
