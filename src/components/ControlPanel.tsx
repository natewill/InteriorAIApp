'use client';

import { useAppStore } from '@/store/useAppStore';
import ModeToggle from './ModeToggle';
import {
  AddModePanel,
  TransformModePanel,
  RemoveModePanel,
} from './ControlPanelParts';

export default function ControlPanel() {
  const mode = useAppStore((state) => state.mode);

  const getModeIndex = (m: string) => {
    switch (m) {
      case 'add': return 0;
      case 'transform': return 1;
      case 'remove': return 2;
      default: return 0;
    }
  };

  const activeIndex = getModeIndex(mode);

  return (
    <div
      data-tour="control-panel"
      className="flex h-full w-80 flex-col gap-5 border-r border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
    >
      {/* Mode Toggle - Fixed at top */}
      <div className="shrink-0">
        <ModeToggle />
      </div>

      {/* Sliding Content Area */}
      <div className="flex-1 overflow-hidden">
        <div
          className="flex h-full w-[300%] transition-transform duration-300 ease-in-out will-change-transform items-start"
          style={{ transform: `translateX(-${activeIndex * (100 / 3)}%)` }}
        >
          {/* Add Mode Slide */}
          <AddModePanel />

          {/* Transform Mode Slide */}
          <TransformModePanel />

          {/* Remove Mode Slide */}
          <RemoveModePanel />
        </div>
      </div>

    </div>
  );
}
