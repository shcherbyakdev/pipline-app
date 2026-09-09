"use client";

import * as React from "react";

const REDUCED = "(prefers-reduced-motion: reduce)";
function subscribe(cb: () => void) {
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
/** True when the visitor asked for less motion; false on the server. */
export function usePrefersReducedMotion() {
  return React.useSyncExternalStore(subscribe, () => window.matchMedia(REDUCED).matches, () => false);
}
