"use client";

import * as React from "react";
import { HANDLE_RE } from "./handle";
import { checkHandle, type HandleCheck } from "./handle-actions";

// Debounced availability for a handle field. `result` is null while the
// value isn't a complete handle yet, or while a check for the *current*
// value hasn't resolved, so callers never show a stale or wrong verdict —
// only the format hint or a "checking" spinner. Stale responses (the value
// changed again before the previous check resolved) are dropped.
//
// `checking`/`result` are derived from whether the last settled response
// matches the current handle, rather than flags set synchronously inside
// the effect. eslint-plugin-react-hooks' set-state-in-effect rule forbids
// synchronous setState in an effect body (only inside an async callback
// responding to the external system — here, the debounce timer/fetch — is
// allowed), so there's no `setChecking(true)` at the top of the effect the
// way a naive version would have it.
export function useHandleCheck(
  handle: string,
  { enabled = true, delayMs = 400 }: { enabled?: boolean; delayMs?: number } = {},
): { result: HandleCheck | null; checking: boolean } {
  const [settled, setSettled] = React.useState<{ handle: string; result: HandleCheck } | null>(
    null,
  );

  const active = enabled && HANDLE_RE.test(handle);

  React.useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const r = await checkHandle(handle);
      if (cancelled) return;
      setSettled({ handle, result: r });
    }, delayMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [handle, active, delayMs]);

  if (!active) return { result: null, checking: false };
  if (settled?.handle === handle) return { result: settled.result, checking: false };
  return { result: null, checking: true };
}
