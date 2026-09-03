"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { toastRefusal } from "@/features/billing/refusal-toast";
import { updateStaff } from "@/features/scheduling/staff-actions";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import { STAFF_COLORS, initials } from "@/features/scheduling/staff-slug";
import { bookingPath } from "@/lib/booking/url";
import { dialogBareInputClass } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// Browser-side twin of STAFF_SLUG_RE (staff-form.tsx carries the full note).
const SLUG_PATTERN = "[a-z0-9]([a-z0-9\\-]{0,38}[a-z0-9])?";

// Text until focused — the dialog's bare-input idiom — plus a focus ring, so
// a keyboard user can see where they are on a page with no borders.
const inlineClass = cn(
  dialogBareInputClass,
  "-mx-1 w-auto min-w-0 rounded-md px-1 focus-visible:ring-3 focus-visible:ring-ring/30",
);
// Grows with its text where the browser can (Chrome 123+, Safari 18+);
// elsewhere the input keeps its default width, which fits a name.
const fit = { fieldSizing: "content" } as React.CSSProperties;

type Field = "name" | "email" | "slug" | "color";

/* The person's identity, edited in place: name, email and link are inputs
   that read as text and save on blur (Enter commits, Escape reverts); the
   avatar opens the colour swatches and a pick saves at once. No form, no
   Save. Each save sends ONE field — updateStaff patches what it is given —
   and snaps back with the action's own words if it refuses. */
export function MemberHeader({
  staff,
  handle,
  badges,
  children,
}: {
  staff: StaffRow;
  handle: string | null;
  /** Role / inactive / over-limit, decided by the page. */
  badges: React.ReactNode;
  /** Sits after the link (the copy button, when there is a public link). */
  children?: React.ReactNode;
}) {
  const t = useTranslations("team");
  const tCommon = useTranslations("common");
  const [, startTransition] = React.useTransition();
  const [values, setValues] = React.useState({
    name: staff.name,
    email: staff.email ?? "",
    slug: staff.slug,
    color: staff.color,
  });
  // What the server has. Reverts go here, not to the prop, which lags a
  // save by one render.
  const saved = React.useRef(values);
  const set = (field: Field, value: string) => setValues((v) => ({ ...v, [field]: value }));

  const commit = (field: Field, raw: string, valid = true) => {
    const value = field === "name" ? raw.trim() : raw;
    const prev = saved.current[field];
    if (!valid || (field === "name" && value === "")) {
      set(field, prev);
      return;
    }
    set(field, value);
    if (value === prev) return;
    saved.current = { ...saved.current, [field]: value };
    startTransition(async () => {
      const result = await updateStaff({ id: staff.id, [field]: value });
      if (!result.ok) {
        saved.current = { ...saved.current, [field]: prev };
        set(field, prev);
        toastRefusal(result.error, result.upgrade);
      }
    });
  };

  const onKey = (field: Field, e: React.KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    if (e.key === "Enter") el.blur();
    if (e.key === "Escape") {
      set(field, saved.current[field]);
      // Blur after React has put the old value back, so the blur commits a no-op.
      requestAnimationFrame(() => el.blur());
    }
  };

  const linkPrefix = `${bookingPath(handle ?? "…")}/`;

  return (
    <div className="flex items-center gap-3">
      <Popover>
        <PopoverTrigger
          aria-label={t("form.colour")}
          style={{ background: values.color }}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-medium text-white outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          {initials(values.name)}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-2">
          <div role="group" aria-label={t("form.colour")} className="flex gap-2">
            {STAFF_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={t("form.colourNamed", { hex: c })}
                aria-pressed={values.color === c}
                onClick={() => commit("color", c)}
                style={{ background: c }}
                className={cn(
                  "size-6 rounded-full ring-offset-2 ring-offset-popover outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  values.color === c ? "ring-2 ring-foreground" : "ring-1 ring-black/10",
                )}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label={tCommon("name")}
            required
            maxLength={80}
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
            onBlur={(e) => commit("name", e.currentTarget.value)}
            onKeyDown={(e) => onKey("name", e)}
            style={fit}
            className={cn(inlineClass, "max-w-full text-lg font-semibold")}
          />
          {badges}
        </div>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <input
            type="email"
            aria-label={tCommon("email")}
            maxLength={320}
            placeholder={t("detail.addEmail")}
            value={values.email}
            onChange={(e) => set("email", e.target.value)}
            onBlur={(e) => commit("email", e.currentTarget.value, e.currentTarget.checkValidity())}
            onKeyDown={(e) => onKey("email", e)}
            style={fit}
            className={cn(inlineClass, "max-w-full text-sm")}
          />
          <span className="flex min-w-0 items-center font-mono">
            {linkPrefix}
            <input
              aria-label={t("columns.link")}
              required
              minLength={2}
              maxLength={40}
              pattern={SLUG_PATTERN}
              title={t("form.slugHint")}
              value={values.slug}
              // Typing can't produce a character the slug rules reject.
              onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              onBlur={(e) => {
                const valid = e.currentTarget.checkValidity();
                if (!valid) toast.error(t("form.slugHint"));
                commit("slug", e.currentTarget.value, valid);
              }}
              onKeyDown={(e) => onKey("slug", e)}
              style={fit}
              className={cn(inlineClass, "font-mono text-xs")}
            />
          </span>
          {children}
        </div>
      </div>
    </div>
  );
}
