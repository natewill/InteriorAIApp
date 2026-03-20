'use client';

import { useEffect, useMemo, useState } from 'react';

const TOUR_SEEN_KEY = 'interiorai_onboarding_v1_seen';

type TourTarget =
  | { kind: 'selector'; selector: string }
  | { kind: 'screen' };

interface TourStep {
  title: string;
  description: string;
  target: TourTarget;
}

type TourState =
  | { kind: 'closed' }
  | { kind: 'open'; stepIndex: number };

const TOUR_STEPS: TourStep[] = [
  {
    title: 'Choose what you want to do',
    description: 'Start by picking a mode: Add to place new furniture, Transform to restyle the room, or Remove to clear furniture out.',
    target: { kind: 'selector', selector: '[data-tour="mode-toggle"]' },
  },
  {
    title: 'Upload your room',
    description: 'Drag, paste, or click to upload a photo of your room that you want to edit!',
    target: { kind: 'selector', selector: '[data-tour="room-upload"]' },
  },
  {
    title: 'Upload a furniture reference',
    description: 'Add a photo of the furniture you want to place in the room or use as the style reference.',
    target: { kind: 'selector', selector: '[data-tour="furniture-upload"]' },
  },
  {
    title: 'Generate your result',
    description: 'When everything looks ready, click this button to run the current mode and create new images.',
    target: { kind: 'selector', selector: '[data-tour="primary-action"]' },
  },
  {
    title: 'Look through your results',
    description: 'Your generated images will show up here when the run finishes. You can flip through them and pick the one you like best.',
    target: { kind: 'selector', selector: '[data-tour="results-view"]' },
  },
  {
    title: 'Find matching furniture',
    description: 'Click Search Furniture in the bottom-left corner of a result image to look up similar pieces and see where they come from.',
    target: { kind: 'selector', selector: '[data-tour="search-furniture"]' },
  },
  {
    title: 'Come back to this anytime',
    description: 'If you ever want a quick refresher, open this guide again from the button in the bottom-right corner.',
    target: { kind: 'screen' },
  },
];

function isTargetAvailable(target: TourTarget): boolean {
  if (target.kind === 'screen') {
    return true;
  }

  return document.querySelector(target.selector) !== null;
}

function findAvailableStepIndex(startIndex: number, direction: 1 | -1): number {
  if (direction === 1) {
    for (let index = startIndex; index < TOUR_STEPS.length; index += 1) {
      if (isTargetAvailable(TOUR_STEPS[index].target)) {
        return index;
      }
    }
    return -1;
  }

  for (let index = startIndex; index >= 0; index -= 1) {
    if (isTargetAvailable(TOUR_STEPS[index].target)) {
      return index;
    }
  }

  return -1;
}

function getAvailableStepIndexes(): number[] {
  const indexes: number[] = [];

  for (let index = 0; index < TOUR_STEPS.length; index += 1) {
    if (isTargetAvailable(TOUR_STEPS[index].target)) {
      indexes.push(index);
    }
  }

  return indexes;
}

function getTargetRect(step: TourStep): DOMRect | null {
  if (step.target.kind === 'screen') {
    return null;
  }

  const element = document.querySelector(step.target.selector);
  if (!(element instanceof HTMLElement)) {
    return null;
  }

  return element.getBoundingClientRect();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export default function OnboardingTour() {
  const [mounted, setMounted] = useState(false);
  const [tourState, setTourState] = useState<TourState>({ kind: 'closed' });
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 1200, height: 800 });

  const startTour = () => {
    const firstStepIndex = findAvailableStepIndex(0, 1);
    if (firstStepIndex === -1) {
      return;
    }
    setTourState({ kind: 'open', stepIndex: firstStepIndex });
  };

  const finishTour = () => {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
    setTourState({ kind: 'closed' });
  };

  const closeTour = () => {
    setTourState({ kind: 'closed' });
  };

  useEffect(() => {
    setMounted(true);
    setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    if (localStorage.getItem(TOUR_SEEN_KEY) === '1') {
      return;
    }
    startTour();
  }, []);

  useEffect(() => {
    if (tourState.kind !== 'open') {
      setTargetRect(null);
      return;
    }

    const step = TOUR_STEPS[tourState.stepIndex];
    const updateLayout = () => {
      setViewportSize({ width: window.innerWidth, height: window.innerHeight });
      setTargetRect(getTargetRect(step));
    };

    updateLayout();
    window.addEventListener('resize', updateLayout);
    window.addEventListener('scroll', updateLayout, true);

    return () => {
      window.removeEventListener('resize', updateLayout);
      window.removeEventListener('scroll', updateLayout, true);
    };
  }, [tourState]);

  const previousStepIndex = useMemo(() => {
    if (tourState.kind !== 'open') {
      return -1;
    }
    return findAvailableStepIndex(tourState.stepIndex - 1, -1);
  }, [tourState]);

  if (!mounted) {
    return null;
  }

  const handleBack = () => {
    if (tourState.kind !== 'open') {
      return;
    }
    if (previousStepIndex === -1) {
      return;
    }
    setTourState({ kind: 'open', stepIndex: previousStepIndex });
  };

  const handleNext = () => {
    if (tourState.kind !== 'open') {
      return;
    }

    const nextStepIndex = findAvailableStepIndex(tourState.stepIndex + 1, 1);
    if (nextStepIndex === -1) {
      finishTour();
      return;
    }

    setTourState({ kind: 'open', stepIndex: nextStepIndex });
  };

  const isOpen = tourState.kind === 'open';
  const currentStep = isOpen ? TOUR_STEPS[tourState.stepIndex] : null;
  const availableStepIndexes = isOpen ? getAvailableStepIndexes() : [];
  const displayStepNumber = isOpen ? availableStepIndexes.indexOf(tourState.stepIndex) + 1 : 0;
  const displayStepCount = availableStepIndexes.length;
  const isLastStep = isOpen && displayStepNumber === displayStepCount;

  const cardWidth = clamp(viewportSize.width - 32, 280, 360);
  const cardHeight = 200;
  const cardLeft = targetRect
    ? clamp(
      targetRect.left + targetRect.width / 2 - cardWidth / 2,
      16,
      viewportSize.width - cardWidth - 16,
    )
    : clamp(viewportSize.width / 2 - cardWidth / 2, 16, viewportSize.width - cardWidth - 16);
  const cardTop = targetRect
    ? (() => {
      const canPlaceBelow = viewportSize.height - targetRect.bottom > cardHeight + 24;
      if (canPlaceBelow) {
        return targetRect.bottom + 12;
      }
      return Math.max(16, targetRect.top - cardHeight - 12);
    })()
    : clamp(viewportSize.height / 2 - cardHeight / 2, 16, viewportSize.height - cardHeight - 16);

  return (
    <>
      {!isOpen && (
        <button
          type="button"
          onClick={startTour}
          className="fixed bottom-5 right-5 z-[85] rounded-full border border-zinc-700 bg-zinc-900/90 px-4 py-2 text-xs font-semibold text-zinc-100 shadow-xl transition hover:bg-zinc-800"
        >
          Guide
        </button>
      )}

      {isOpen && currentStep && (
        <>
          <div className="fixed inset-0 z-[100] bg-black/60" />

          {targetRect && (
            <div
              className="pointer-events-none fixed z-[110] rounded-xl border-2 border-blue-400 shadow-[0_0_0_2px_rgba(96,165,250,0.5)] transition-all duration-200"
              style={{
                top: Math.max(6, targetRect.top - 6),
                left: Math.max(6, targetRect.left - 6),
                width: targetRect.width + 12,
                height: targetRect.height + 12,
              }}
            />
          )}

          <section
            className="fixed z-[120] rounded-xl border border-zinc-700 bg-zinc-900 p-4 text-zinc-100 shadow-2xl"
            style={{ top: cardTop, left: cardLeft, width: cardWidth }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              Step {displayStepNumber} of {displayStepCount}
            </p>
            <h3 className="mt-1 text-sm font-semibold">{currentStep.title}</h3>
            <p className="mt-2 text-sm text-zinc-300">{currentStep.description}</p>

            <div className="mt-4 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={finishTour}
                className="rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100"
              >
                Skip tour
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleBack}
                  disabled={previousStepIndex === -1}
                  className="rounded-md border border-zinc-600 px-3 py-1.5 text-xs font-medium text-zinc-100 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleNext}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500"
                >
                  {isLastStep ? 'Finish' : 'Next'}
                </button>
                <button
                  type="button"
                  onClick={closeTour}
                  className="rounded-md px-2 py-1.5 text-xs font-medium text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
                >
                  Close
                </button>
              </div>
            </div>
          </section>
        </>
      )}
    </>
  );
}
