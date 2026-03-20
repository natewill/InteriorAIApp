'use client';

interface CarouselDotsProps {
    count: number;
    selectedIndex: number;
    onSelect: (index: number) => void;
}

export default function CarouselDots({
    count,
    selectedIndex,
    onSelect,
}: CarouselDotsProps) {
    return (
        <div className="absolute bottom-6 left-1/2 z-30 flex -translate-x-1/2 gap-2">
            {Array.from({ length: count }).map((_, index) => (
                <button
                    key={index}
                    onClick={(e) => {
                        e.stopPropagation();
                        onSelect(index);
                    }}
                    className={`
            h-2.5 w-2.5 rounded-full transition-all duration-300
            ${index === selectedIndex
                            ? 'scale-125 bg-blue-500'
                            : 'bg-zinc-400 hover:bg-zinc-300 dark:bg-zinc-600 dark:hover:bg-zinc-500'
                        }
          `}
                    aria-label={`Go to image ${index + 1}`}
                />
            ))}
        </div>
    );
}
