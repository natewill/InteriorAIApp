'use client';

import { IMAGE_VALIDATION } from '@/lib/imageValidation';
import { useImageUpload } from '@/hooks/useImageUpload';

interface ImageUploadProps {
  label: string;
  image: string | null;
  onImageChange: (image: string | null) => void;
  className?: string;
  compact?: boolean;
}

export default function ImageUpload({
  label,
  image,
  onImageChange,
  className = '',
  compact = false,
}: ImageUploadProps) {
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
    <div className={className}>
      <label
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onMouseEnter={() => setPasteTarget(true)}
        onMouseLeave={() => setPasteTarget(false)}
        className={`
          relative flex cursor-pointer flex-col items-center justify-center
          rounded-xl border-2 border-dashed transition-all
          ${compact ? 'aspect-square' : 'aspect-[4/3]'}
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
          className="sr-only"
        />

        {image ? (
          <>
            <img
              src={image}
              alt="Uploaded"
              className="absolute inset-0 h-full w-full rounded-xl object-cover"
            />
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={handleRemove}
              className="absolute right-2 top-2 rounded-full bg-black/50 p-1.5 text-white transition-colors hover:bg-black/70"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 p-4 text-center">
            <svg
              className={`text-zinc-400 dark:text-zinc-500 ${compact ? 'h-8 w-8' : 'h-10 w-10'}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <span className={`font-medium text-zinc-600 dark:text-zinc-400 ${compact ? 'text-sm' : 'text-sm'}`}>
              {label}
            </span>
            {!compact && (
              <span className="text-xs text-zinc-400 dark:text-zinc-500">
                Drag & drop or click to upload
              </span>
            )}
          </div>
        )}
      </label>
      {error && (
        <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {!error && !compact && (
        <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
          PNG, JPG, WEBP up to {Math.round(IMAGE_VALIDATION.maxSizeBytes / (1024 * 1024))}MB
        </p>
      )}
    </div>
  );
}
