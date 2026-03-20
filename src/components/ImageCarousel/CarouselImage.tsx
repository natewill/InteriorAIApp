'use client';

import { getImageTransform } from '@/constants/carousel';

interface CarouselImageProps {
    image: string;
    index: number;
    selectedIndex: number;
    imageCount: number;
    isHovered: boolean;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onSelect: () => void;
    onOpen: () => void;
    onSearchFurniture: () => void;
}

export default function CarouselImage({
    image,
    index,
    selectedIndex,
    imageCount,
    isHovered,
    onMouseEnter,
    onMouseLeave,
    onSelect,
    onOpen,
    onSearchFurniture,
}: CarouselImageProps) {
    const { transform, opacity, zIndex } = getImageTransform(
        index,
        selectedIndex,
        imageCount,
        0
    );
    const isCenter = index === selectedIndex;

    return (
        <div
            className={`absolute flex justify-center select-none transition-all duration-300 ease-out ${isCenter ? 'pointer-events-none' : 'pointer-events-auto'}`}
            style={{
                transform,
                opacity,
                zIndex,
                width: '70%',
                maxWidth: '900px',
            }}
            onClick={!isCenter ? onSelect : undefined}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            <div
                className={`
          relative mx-auto inline-flex max-w-full overflow-hidden rounded-2xl shadow-2xl transition-shadow duration-300 pointer-events-auto
          ${isCenter ? 'ring-4 ring-carousel-ring' : ''}
          ${isHovered && !isCenter ? 'ring-2 ring-carousel-ring-hover' : ''}
        `}
            >
                <img
                    src={image}
                    alt={`Result ${index + 1}`}
                    className={`mx-auto max-h-[70vh] w-auto max-w-full object-contain ${isCenter ? 'cursor-zoom-in' : ''}`}
                    onClick={(e) => {
                        if (!isCenter) return;
                        e.stopPropagation();
                        onOpen();
                    }}
                    draggable={false}
                />

                <button
                    data-tour={isCenter ? 'search-furniture' : undefined}
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onSearchFurniture();
                    }}
                    className="absolute bottom-3 left-3 rounded-lg border border-zinc-200/40 bg-black/70 px-3 py-1.5 text-xs font-medium text-white shadow-lg transition hover:bg-black/80"
                >
                    Search Furniture
                </button>
            </div>
        </div>
    );
}
