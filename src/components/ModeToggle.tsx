'use client';

import { useAppStore, useAppActions } from '@/store/useAppStore';


export default function ModeToggle() {
  const mode = useAppStore((state) => state.mode);
  const { setMode } = useAppActions();
  return (
    <div data-tour="mode-toggle" className="relative flex w-full rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800 isolate">
      {/* Sliding Background Pill */}
      <div
        className="absolute inset-y-1 w-[calc(33.333%-0.33rem)] rounded-md bg-white shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] dark:bg-zinc-700"
        style={{
          transform: `translateX(${mode === 'add' ? '0%' : mode === 'transform' ? '100%' : '200%'
            }) translateX(${mode === 'add' ? '0' : mode === 'transform' ? '2px' : '4px'})`
        }}
      />

      <button
        className={`relative z-10 flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${mode === 'add'
          ? 'text-zinc-900 dark:text-zinc-100'
          : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
          }`}
        onClick={() => setMode('add')}
      >
        Add
      </button>
      <button
        className={`relative z-10 flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${mode === 'transform'
          ? 'text-zinc-900 dark:text-zinc-100'
          : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
          }`}
        onClick={() => setMode('transform')}
      >
        Transform
      </button>
      <button
        className={`relative z-10 flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${mode === 'remove'
          ? 'text-zinc-900 dark:text-zinc-100'
          : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
          }`}
        onClick={() => setMode('remove')}
      >
        Remove
      </button>
    </div>
  );
}
