"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";

/* The chrome every layout but the week list shares (TimeSlotGrid keeps
   its own — the rentals hourly flows use it as it is): the header row with
   the paging arrows, the person switch, the live region, the timezone
   notes. While a new window loads, the previous times stay put (dimmed) so
   the region doesn't collapse and re-expand. */
export function SlotFrame({
  headerSlot, nav, toolbar, pending, empty, emptyText, regionRef, orgTimeZone, children,
}: {
  headerSlot?: React.ReactNode;
  /** Paging arrows, or null for a layout that pages inside its body. */
  nav: { label?: string; prevDisabled: boolean; onPrev: () => void; onNext: () => void; prevLabel: string; nextLabel: string } | null;
  toolbar?: React.ReactNode;
  pending: boolean;
  empty: boolean;
  emptyText: string;
  regionRef?: React.Ref<HTMLDivElement>;
  orgTimeZone: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("public.slots");
  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        {headerSlot}
        {nav ? (
          <div className="flex items-center gap-2">
            {nav.label ? <span className="text-muted-foreground text-xs tabular-nums">{nav.label}</span> : null}
            <Button variant="outline" size="icon-sm" className="wt-surface" aria-label={nav.prevLabel} title={nav.prevLabel} disabled={nav.prevDisabled} onClick={nav.onPrev}>
              <HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
            </Button>
            <Button variant="outline" size="icon-sm" className="wt-surface" aria-label={nav.nextLabel} title={nav.nextLabel} onClick={nav.onNext}>
              <HugeiconsIcon icon={ArrowRight01Icon} size={16} />
            </Button>
          </div>
        ) : null}
      </div>
      {toolbar}
      <div
        ref={regionRef}
        tabIndex={-1}
        aria-live="polite"
        aria-busy={pending || undefined}
        // outline-none: focus arrives programmatically after a pick; the
        // visible rings belong on the slot buttons.
        className={pending ? "flex flex-col gap-4 opacity-60 outline-none transition-opacity" : "flex flex-col gap-4 outline-none"}
      >
        {pending && empty ? (
          <p className="text-muted-foreground text-sm">{t("loading")}</p>
        ) : empty ? (
          <p className="text-muted-foreground text-sm">{emptyText}</p>
        ) : (
          children
        )}
      </div>
      <p className="text-muted-foreground text-xs">{t("viewerTz", { tz: viewerTz })}</p>
      {viewerTz !== orgTimeZone ? (
        <p className="text-muted-foreground text-xs">{t("orgTz", { tz: orgTimeZone })}</p>
      ) : null}
    </>
  );
}
