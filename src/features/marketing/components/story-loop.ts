"use client";

import * as React from "react";

const REDUCED = "(prefers-reduced-motion: reduce)";
function subscribeReducedMotion(cb: () => void) {
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
export function usePrefersReducedMotion() {
  return React.useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED).matches,
    () => false,
  );
}

/* A scripted story for a product fragment: `at[i]` is the ms offset at
   which step i begins, `period` the loop length. Returns the current step.
   State-driven so every change in the fragment is a CSS transition (the
   hero widget's idiom): interruptible, nothing jumps, no keyframe per
   row. Under reduced motion it parks on `park` (default: the last step)
   and never loops; a story whose last step is its exit passes the step
   before it. `at` must be a module constant (it's a dependency). */
export function useStoryLoop(at: readonly number[], period: number, park = at.length - 1): number {
  const reduced = usePrefersReducedMotion();
  const [step, setStep] = React.useState(0);

  React.useEffect(() => {
    if (reduced) return;
    let timers: number[] = [];
    const run = () => {
      timers.forEach(clearTimeout);
      timers = at.map((t, i) => window.setTimeout(() => setStep(i), t));
      timers.push(window.setTimeout(run, period));
    };
    run();
    return () => timers.forEach(clearTimeout);
  }, [reduced, at, period]);

  return reduced ? park : step;
}
