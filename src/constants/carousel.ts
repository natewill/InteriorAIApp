// Carousel constants and utility functions

export const CAROUSEL_CONFIG = {
    ITEM_WIDTH: 300,
    OFFSET_PER_ITEM: 65,
    MIN_SCALE: 0.7,
    MIN_OPACITY: 0.5,
} as const;

/**
 * Calculate transform properties for a carousel image
 */
export function getImageTransform(
    index: number,
    selectedIndex: number,
    imageCount: number,
    dragOffset: number = 0
) {
    const diff = index - selectedIndex;
    const { ITEM_WIDTH, OFFSET_PER_ITEM, MIN_SCALE, MIN_OPACITY } = CAROUSEL_CONFIG;

    // Normalize diff for wrapping
    let normalizedDiff = diff;
    if (diff > imageCount / 2) normalizedDiff = diff - imageCount;
    if (diff < -imageCount / 2) normalizedDiff = diff + imageCount;

    // Calculate offset with drag
    const offsetPercent = (dragOffset / ITEM_WIDTH) * 100;
    const baseOffset = normalizedDiff * OFFSET_PER_ITEM;
    const draggedOffset = baseOffset + (offsetPercent * 0.65);

    // Scale based on distance from center
    const distanceFromCenter = Math.abs(draggedOffset) / OFFSET_PER_ITEM;
    const scale = Math.max(MIN_SCALE, 1 - distanceFromCenter * 0.15);
    const opacity = Math.max(MIN_OPACITY, 1 - distanceFromCenter * 0.3);
    const zIndex = Math.round(20 - distanceFromCenter * 5);

    return {
        transform: `translateX(${draggedOffset}%) scale(${scale})`,
        opacity,
        zIndex,
        distanceFromCenter,
        normalizedDiff,
    };
}

/**
 * Check if an image should be visible in the carousel
 */
export function isImageVisible(
    index: number,
    selectedIndex: number,
    imageCount: number,
    dragOffset: number = 0
): boolean {
    const diff = index - selectedIndex;
    const { ITEM_WIDTH } = CAROUSEL_CONFIG;

    let normalizedDiff = diff;
    if (diff > imageCount / 2) normalizedDiff = diff - imageCount;
    if (diff < -imageCount / 2) normalizedDiff = diff + imageCount;

    const offsetItems = dragOffset / ITEM_WIDTH;
    const effectiveDiff = normalizedDiff + offsetItems;

    return Math.abs(effectiveDiff) < 2;
}
