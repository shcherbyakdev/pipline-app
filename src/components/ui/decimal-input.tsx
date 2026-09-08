"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";

/* A decimal field that survives being typed in. A controlled
   `type="number"` round-tripped through cents cannot hold a half-typed
   number: the HTML sanitiser reports "" for "89.", so the state took 0 and
   "89.50" landed as 0.50. This keeps the raw string while the field is
   being edited and commits once — on blur or Enter — normalising "," to
   ".". `value` and the committed number are both in display units (major
   currency, or hours for a band's start), so the caller does the ×100 / ×60. */
export function DecimalInput({
  value, min = 0, onCommit, ...rest
}: { value: number; min?: number; onCommit: (v: number) => void } & Omit<
  React.ComponentProps<typeof Input>,
  "value" | "min" | "onChange" | "onBlur" | "onKeyDown"
>) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft.trim().replace(",", "."));
    if (draft.trim() !== "" && Number.isFinite(n) && n >= min) onCommit(n);
    setDraft(null);
  };
  return (
    <Input
      {...rest}
      type="text"
      inputMode="decimal"
      value={draft ?? String(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
      }}
    />
  );
}
