"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { initials } from "@/features/scheduling/staff-slug";
import { cn } from "@/lib/utils";

/* The person picker, inline above the times. It replaced the blocking "Who
   would you like to book with?" step: times load for "Anyone" the moment a
   service is picked, and the visitor who has a preference clicks once here
   — no one clicks more than before, most click less. Native radios styled
   as chips: arrow keys, focus and the group semantics come for free. The
   chosen chip wears `wt-primary` (the accent) rather than a border colour,
   because the widget theme repaints every border-* utility to its line
   colour (globals.css) and would flatten a border-only selected state. */
export function StaffSwitch({
  options,
  value,
  onChange,
}: {
  options: Array<{ id: string; name: string; color: string }>;
  /** A staff id, or "any". */
  value: string;
  onChange: (id: string) => void;
}) {
  const t = useTranslations("public.widget");
  const name = React.useId();
  const all: Array<{ id: string; name: string; color: string | null }> = [{ id: "any", name: t("anyone"), color: null }, ...options];
  return (
    <fieldset className="flex flex-wrap items-center gap-2">
      <legend className="sr-only">{t("bookWith")}</legend>
      <span aria-hidden className="text-muted-foreground text-xs">{t("withShort")}</span>
      {all.map((o) => {
        const checked = value === o.id;
        return (
          <label
            key={o.id}
            className={cn(
              "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-[background-color,color,box-shadow] duration-150 ease-strong",
              "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--widget-accent)] has-[:focus-visible]:ring-offset-1",
              checked ? "wt-primary" : "wt-chip",
            )}
          >
            <input type="radio" name={name} value={o.id} checked={checked} onChange={() => onChange(o.id)} className="sr-only" />
            {o.color ? (
              <span
                aria-hidden
                className="wt-round inline-flex size-4 items-center justify-center rounded-full text-[8px] font-semibold text-white"
                style={{ background: o.color }}
              >
                {initials(o.name)}
              </span>
            ) : null}
            {o.name}
          </label>
        );
      })}
    </fieldset>
  );
}
