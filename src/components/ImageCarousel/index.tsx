'use client';

import { useState } from 'react';
import { ImageCarouselProps } from '@/types';
import { CAROUSEL_CONFIG, getImageTransform, isImageVisible } from '@/constants/carousel';
import CarouselImage from './CarouselImage';
import CarouselDots from './CarouselDots';
import FullscreenModal from './FullscreenModal';
import FurnitureFinderModal from './FurnitureFinderModal';

export default function ImageCarousel({
    images,
    selectedIndex,
    onSelect,
}: ImageCarouselProps) {
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [furnitureFinderTarget, setFurnitureFinderTarget] = useState<{ imageUrl: string; imageIndex: number } | null>(null);

    const hasMultipleImages = images.length > 1;
    const leftIndex = hasMultipleImages
        ? (selectedIndex - 1 + images.length) % images.length
        : selectedIndex;
    const rightIndex = hasMultipleImages
        ? (selectedIndex + 1) % images.length
        : selectedIndex;

    const getArrowTransform = (index: number) => {
        const { normalizedDiff } = getImageTransform(index, selectedIndex, images.length, 0);
        const offset = normalizedDiff * CAROUSEL_CONFIG.OFFSET_PER_ITEM * 0.95;
        return `translateX(${offset}%)`;
    };

    const handleImageClick = (index: number) => {
        if (index !== selectedIndex) {
            onSelect(index);
            return;
        }

        setIsFullscreen(true);
    };

    return (
        <>
            <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-zinc-100 dark:bg-zinc-900">
                {/* Images Container */}
                <div className="relative flex h-full w-full items-center justify-center">
                    {images.map((image, index) => {
                        if (!isImageVisible(index, selectedIndex, images.length, 0)) {
                            return null;
                        }

                        return (
                            <CarouselImage
                                key={index}
                                image={image}
                                index={index}
                                selectedIndex={selectedIndex}
                                imageCount={images.length}
                                isHovered={hoveredIndex === index}
                                onMouseEnter={() => setHoveredIndex(index)}
                                onMouseLeave={() => setHoveredIndex(null)}
                                onSelect={() => handleImageClick(index)}
                                onOpen={() => setIsFullscreen(true)}
                                onSearchFurniture={() => setFurnitureFinderTarget({ imageUrl: image, imageIndex: index })}
                            />
                        );
                    })}
                </div>

                {hasMultipleImages && (
                    <>
                        <div
                            className="pointer-events-none absolute top-1/2 z-40 flex w-[70%] max-w-[900px] -translate-y-1/2 justify-center"
                            style={{ transform: getArrowTransform(leftIndex) }}
                        >
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onSelect(leftIndex);
                                }}
                                className="group pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full bg-black/80 text-3xl font-semibold text-white shadow-lg transition-transform hover:scale-105 hover:bg-black/90 active:scale-95"
                                aria-label="Previous image"
                            >
                                <span className="transition-transform duration-200 group-hover:scale-110">
                                    {'<'}
                                </span>
                            </button>
                        </div>
                        <div
                            className="pointer-events-none absolute top-1/2 z-40 flex w-[70%] max-w-[900px] -translate-y-1/2 justify-center"
                            style={{ transform: getArrowTransform(rightIndex) }}
                        >
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onSelect(rightIndex);
                                }}
                                className="group pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full bg-black/80 text-3xl font-semibold text-white shadow-lg transition-transform hover:scale-105 hover:bg-black/90 active:scale-95"
                                aria-label="Next image"
                            >
                                <span className="transition-transform duration-200 group-hover:scale-110">
                                    {'>'}
                                </span>
                            </button>
                        </div>
                    </>
                )}

                <div className="pointer-events-none absolute left-1/2 top-1/2 z-30 w-[70%] max-w-[900px] -translate-x-1/2 -translate-y-1/2">
                    <div className="aspect-[16/10]" />
                    <div className="mt-3 flex justify-center">
                        <div className="rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-white">
                            Result {selectedIndex + 1} of {images.length}
                        </div>
                    </div>
                </div>

                <CarouselDots
                    count={images.length}
                    selectedIndex={selectedIndex}
                    onSelect={onSelect}
                />
            </div>

            <FullscreenModal
                isOpen={isFullscreen}
                onClose={() => setIsFullscreen(false)}
                imageUrl={images[selectedIndex]}
                imageIndex={selectedIndex}
            />

            {furnitureFinderTarget && (
                <FurnitureFinderModal
                    isOpen={furnitureFinderTarget !== null}
                    onClose={() => setFurnitureFinderTarget(null)}
                    imageUrl={furnitureFinderTarget.imageUrl}
                    imageIndex={furnitureFinderTarget.imageIndex}
                />
            )}
        </>
    );
}
