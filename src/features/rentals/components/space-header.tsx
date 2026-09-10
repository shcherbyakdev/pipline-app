"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toastRefusal } from "@/features/billing/refusal-toast";
import { patchOffering } from "@/features/rentals/actions";
import type { OfferingRow } from "@/features/rentals/queries";
import { dialogBareInputClass } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// Text until focused — the dialog's bare-input idiom (client-header.tsx
// does the same for a client's name) — plus a focus ring so a keyboard
// user can see where they are on a page with no borders.
const inlineClass = cn(
  dialogBareInputClass,
  "-mx-1 rounded-md px-1 focus-visible:ring-3 focus-visible:ring-ring/30",
);
// Grows with its text where the browser can (Chrome 123+, Safari 18+);
// elsewhere the input keeps the bare class's full width, so a long name is
// never clipped to the UA's ~20-character box.
const fit = { fieldSizing: "content" } as React.CSSProperties;

type Field = "name" | "description";

/* The space's identity, edited in place: name and description read as
   text and save on blur (Enter commits the name, Escape reverts either).
   Each save sends ONE field — patchOffering — and snaps back with the
   action's own words if it refuses. `saved` only moves for the newest edit
   of a field, whichever order the responses land in, so a refusal never
   reverts to a value the server no longer holds. */
export function SpaceHeader({
  offering,
  badges,
  meta,
}: {
  offering: OfferingRow;
  /** Mode / inactive / not-bookable, decided by the page. */
  badges: React.ReactNode;
  /** The schedule line under the name. */
  meta: string;
}) {
  const t = useTranslations("spaces");
  const tCommon = useTranslations("common");
  const [, startTransition] = React.useTransition();
  const [values, setValues] = React.useState({ name: offering.name, description: offering.description ?? "" });
  const saved = React.useRef(values);
  const latest = React.useRef(values);
  const set = (field: Field, value: string) => setValues((v) => ({ ...v, [field]: value }));

  const commit = (field: Field, raw: string) => {
    const value = raw.trim();
    const prev = latest.current[field];
    if (field === "name" && value === "") {
      set(field, prev);
      return;
    }
    set(field, value);
    if (value === prev) return;
    latest.current = { ...latest.current, [field]: value };
    startTransition(async () => {
      const result = await patchOffering({ id: offering.id, [field]: value });
      // An older request answering after a newer one has nothing to say.
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

  const onKey = (field: Field, e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if (e.key === "Enter" && field === "name") el.blur();
    if (e.key === "Escape") {
      set(field, latest.current[field]);
      requestAnimationFrame(() => el.blur());
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label={tCommon("name")}
          required
          maxLength={200}
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          onBlur={(e) => commit("name", e.currentTarget.value)}
          onKeyDown={(e) => onKey("name", e)}
          style={fit}
          className={cn(inlineClass, "min-w-0 max-w-full text-lg font-semibold supports-[field-sizing:content]:w-auto")}
        />
        {badges}
      </div>
      <textarea
        aria-label={t("form.description")}
        maxLength={2000}
        rows={values.description.length > 120 ? 3 : 1}
        placeholder={t("form.descriptionPlaceholder")}
        value={values.description}
        onChange={(e) => set("description", e.target.value)}
        onBlur={(e) => commit("description", e.currentTarget.value)}
        onKeyDown={(e) => onKey("description", e)}
        className={cn(inlineClass, "text-muted-foreground w-full max-w-lg resize-none text-sm")}
      />
      <p className="text-muted-foreground text-xs">{meta}</p>
    </div>
  );
}
