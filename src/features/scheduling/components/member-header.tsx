"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { toastRefusal } from "@/features/billing/refusal-toast";
import { updateStaff } from "@/features/scheduling/staff-actions";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import { STAFF_SLUG_PATTERN, initials } from "@/features/scheduling/staff-slug";
import { ColorSwatches } from "./color-swatches";
import { bookingPath } from "@/lib/booking/url";
import { dialogBareInputClass } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// Text until focused — the dialog's bare-input idiom — plus a focus ring, so
// a keyboard user can see where they are on a page with no borders.
const inlineClass = cn(
  dialogBareInputClass,
  "-mx-1 min-w-0 rounded-md px-1 focus-visible:ring-3 focus-visible:ring-ring/30",
);
// Grows with its text where the browser can (Chrome 123+, Safari 18+);
// elsewhere the input keeps the bare class's full width, so a long name is
// never clipped to the UA's ~20-character box.
const fit = { fieldSizing: "content" } as React.CSSProperties;

type Field = "name" | "email" | "slug" | "color";

/* The person's identity, edited in place: name, email and link are inputs
   that read as text and save on blur (Enter commits, Escape reverts); the
   avatar opens the colour swatches and a pick saves at once. No form, no
   Save. Each save sends ONE field — updateStaff patches what it is given —
   and snaps back with the action's own words if it refuses. A refusal only
   reverts if no newer edit of that field has been asked for since. */
export function MemberHeader({
  staff,
  handle,
  badges,
}: {
  staff: StaffRow;
  handle: string | null;
  /** Role / inactive / over-limit, decided by the page. */
  badges: React.ReactNode;
}) {
  const t = useTranslations("team");
  const tCommon = useTranslations("common");
  const emailInvalid = useTranslations("auth.errors")("emailInvalid");
  const [, startTransition] = React.useTransition();
  const [values, setValues] = React.useState({
    name: staff.name,
    email: staff.email ?? "",
    slug: staff.slug,
    color: staff.color,
  });
  // `saved`: what the server has confirmed. `latest`: what was last asked
  // for — the same thing except while a save is in flight. Reverts go to
  // these, never to the prop, which lags a save by one render.
  const saved = React.useRef(values);
  const latest = React.useRef(values);
  const set = (field: Field, value: string) => setValues((v) => ({ ...v, [field]: value }));

  const commit = (field: Field, raw: string, valid = true) => {
    // Normalised here the way the schema normalises, so the field shows what
    // was stored (the action answers with a bare ok, not the row).
    const value = field === "email" ? raw.trim().toLowerCase() : field === "name" ? raw.trim() : raw;
    const prev = latest.current[field];
    if (!valid || (field === "name" && value === "")) {
      if (!valid) toast.error(field === "email" ? emailInvalid : t("form.slugHint"));
      set(field, prev);
      return;
    }
    set(field, value);
    if (value === prev) return;
    latest.current = { ...latest.current, [field]: value };
    startTransition(async () => {
      const result = await updateStaff({ id: staff.id, [field]: value });
      // An older request answering after a newer one has nothing to say —
      // whichever way it went, the newer edit owns the field now.
      if (latest.current[field] !== value) {
        if (!result.ok) toastRefusal(result.error, result.upgrade);
        return;
      }
      if (result.ok) {
        saved.current = { ...saved.current, [field]: value };
        return;
      }
      toastRefusal(result.error, result.upgrade);
      latest.current = { ...latest.current, [field]: saved.current[field] };
      set(field, saved.current[field]);
    });
  };

  const onKey = (field: Field, e: React.KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    if (e.key === "Enter") el.blur();
    if (e.key === "Escape") {
      set(field, latest.current[field]);
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
          <ColorSwatches value={values.color} onChange={(c) => commit("color", c)} className="ring-offset-popover" />
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
            className={cn(inlineClass, "max-w-full text-lg font-semibold supports-[field-sizing:content]:w-auto")}
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
            className={cn(inlineClass, "max-w-full text-sm supports-[field-sizing:content]:w-auto")}
          />
          <span className="flex min-w-0 items-center font-mono">
            {linkPrefix}
            <input
              aria-label={t("columns.link")}
              required
              minLength={2}
              maxLength={40}
              pattern={STAFF_SLUG_PATTERN}
              title={t("form.slugHint")}
              value={values.slug}
              // Typing can't produce a character the slug rules reject.
              onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              onBlur={(e) => commit("slug", e.currentTarget.value, e.currentTarget.checkValidity())}
              onKeyDown={(e) => onKey("slug", e)}
              style={fit}
              className={cn(inlineClass, "font-mono text-xs")}
            />
          </span>
        </div>
      </div>
    </div>
  );
}
