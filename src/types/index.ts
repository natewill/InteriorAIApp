// Shared types for InteriorAI app

export type Mode = 'add' | 'transform' | 'remove';

export interface SegmentPoint {
    x: number;
    y: number;
    label: 1 | 0; // 1 = foreground (select), 0 = background (exclude)
}

export interface ImageCarouselProps {
    images: string[];
    selectedIndex: number;
    onSelect: (index: number) => void;
}

export interface FullscreenModalProps {
    isOpen: boolean;
    onClose: () => void;
    imageUrl: string;
    imageIndex: number;
}
