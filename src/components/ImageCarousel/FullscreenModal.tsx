'use client';

import { FullscreenModalProps } from '@/types';

export default function FullscreenModal({
    isOpen,
    onClose,
    imageUrl,
    imageIndex,
}: FullscreenModalProps) {
    if (!isOpen) return null;

    const handleDownload = async () => {
        try {
            const response = await fetch(imageUrl);
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = url;
            link.download = `interiorai-result-${imageIndex + 1}-${Date.now()}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            URL.revokeObjectURL(url);
        } catch {
            window.open(imageUrl, '_blank', 'noopener,noreferrer');
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex flex-col bg-black/95"
            onClick={onClose}
        >
            <div
                className="absolute right-6 top-6 z-30 flex items-center gap-3"
                onClick={(e) => e.stopPropagation()}
            >
                <button
                    onClick={handleDownload}
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-600 bg-black/60 text-zinc-200 shadow-md transition-all hover:bg-black/70"
                    aria-label="Download image"
                >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                </button>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onClose();
                    }}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-black/70 text-xl font-semibold text-white transition-transform hover:scale-105 hover:bg-black/80 active:scale-95"
                    aria-label="Close fullscreen"
                >
                    X
                </button>
            </div>

            {/* Fullscreen image */}
            <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
                <img
                    src={imageUrl}
                    alt={`Result ${imageIndex + 1} fullscreen`}
                    className="h-full w-full object-contain"
                    onClick={(e) => e.stopPropagation()}
                />
            </div>
        </div>
    );
}
