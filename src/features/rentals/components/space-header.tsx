"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toastRefusal } from "@/features/billing/refusal-toast";
import { patchOffering } from "@/features/rentals/actions";
import type { OfferingRow } from "@/features/rentals/queries";
import { dialogBareInputClass } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// Text until focused — the dialog's bare-input idiom — plus a focus ring
// (member-header.tsx's rule).
const inlineClass = cn(
  dialogBareInputClass,
  "-mx-1 rounded-md px-1 focus-visible:ring-3 focus-visible:ring-ring/30",
);
const fit = { fieldSizing: "content" } as React.CSSProperties;

type Field = "name" | "description";

/* The space's identity, edited in place (member-header.tsx's model, two
   fields): name and description read as text and save on blur (Enter
   commits the name, Escape reverts either). Each save sends ONE field —
   patchOffering — and snaps back with the action's own words if it refuses;
   a refusal only reverts if no newer edit of that field is pending. */
export function SpaceHeader({
  offering,
  badges,
  meta,
  children,
}: {
  offering: OfferingRow;
  /** Mode / inactive / not-bookable, decided by the page. */
  badges: React.ReactNode;
  /** The schedule line under the name. */
  meta: string;
  /** Sits after the meta line (the copy button, when there is a public link). */
  children?: React.ReactNode;
}) {
  const t = useTranslations("spaces");
  const tCommon = useTranslations("common");
  const [pending, startTransition] = React.useTransition();
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
      if (result.ok) {
        saved.current = { ...saved.current, [field]: value };
        return;
      }
      toastRefusal(result.error, result.upgrade);
      if (latest.current[field] !== value) return;
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
          className={cn(inlineClass, "w-auto min-w-0 max-w-full text-lg font-semibold")}
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
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span>{meta}</span>
        <span className={cn(pending && "invisible")}>{children}</span>
      </div>
    </div>
  );
}
