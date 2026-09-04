"use client";

import { useTranslations } from "next-intl";
import { STAFF_COLORS } from "@/features/scheduling/staff-slug";
import { cn } from "@/lib/utils";

/* The person's colour, picked from the roster palette — a labelled group of
   pressed/unpressed buttons (staff-form.tsx and member-header.tsx share it).
   `className` sets the ring-offset colour to whatever the swatches sit on. */
export function ColorSwatches({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (hex: string) => void;
  className?: string;
}) {
  const t = useTranslations("team.form");
  return (
    <div role="group" aria-label={t("colour")} className="flex flex-wrap gap-2">
      {STAFF_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={t("colourNamed", { hex: c })}
          aria-pressed={value === c}
          onClick={() => onChange(c)}
          style={{ background: c }}
          className={cn(
            "size-6 rounded-full ring-offset-2 ring-offset-background outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === c ? "ring-2 ring-foreground" : "ring-1 ring-black/10",
            className,
          )}
        />
      ))}
    </div>
  );
}
