"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, ArrowRight01Icon, Globe02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { CHIP } from "@/features/booking-page/render/type";

/** The paging discs every picker shares (the landing card's white discs on
    the panel): SlotFrame's month/week arrows, the stay picker's months. */
export function PagerDiscs({ prevDisabled, onPrev, onNext, prevLabel, nextLabel }: {
  prevDisabled: boolean; onPrev: () => void; onNext: () => void; prevLabel: string; nextLabel: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Button variant="outline" size="icon" className={`${CHIP} wt-round`} aria-label={prevLabel} title={prevLabel} disabled={prevDisabled} onClick={onPrev}>
        <HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
      </Button>
      <Button variant="outline" size="icon" className={`${CHIP} wt-round`} aria-label={nextLabel} title={nextLabel} onClick={onNext}>
        <HugeiconsIcon icon={ArrowRight01Icon} size={16} />
      </Button>
    </div>
  );
}

/** "Times in your timezone" — one quiet line with the globe, and the org's
    own zone when it differs. Shared by every picker so the note reads the
    same under a week list and under a month. */
export function TimezoneNote({ orgTimeZone }: { orgTimeZone: string }) {
  const t = useTranslations("public.slots");
  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <div className="text-muted-foreground flex flex-col gap-1 text-xs">
      <p className="flex items-center gap-1.5">
        <HugeiconsIcon icon={Globe02Icon} size={14} aria-hidden className="shrink-0" />
        <span>{t("viewerTz", { tz: viewerTz })}</span>
      </p>
      {viewerTz !== orgTimeZone ? <p className="pl-5">{t("orgTz", { tz: orgTimeZone })}</p> : null}
    </div>
  );
}

/* The chrome every layout but the week list shares (TimeSlotGrid keeps
   its own — the rentals hourly flows use it as it is): the header row with
   the paging discs, the person switch, the live region, the timezone
   note. While a new window loads, the previous times stay put (dimmed) so
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
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {headerSlot}
        {nav ? (
          <div className="ml-auto flex items-center gap-3">
            {nav.label ? <span className="text-sm font-medium whitespace-nowrap tabular-nums">{nav.label}</span> : null}
            <PagerDiscs prevDisabled={nav.prevDisabled} onPrev={nav.onPrev} onNext={nav.onNext} prevLabel={nav.prevLabel} nextLabel={nav.nextLabel} />
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
        className={pending ? "flex flex-col gap-4 opacity-60 outline-none transition-opacity duration-150" : "flex flex-col gap-4 outline-none transition-opacity duration-150"}
      >
        {pending && empty ? (
          <p className="text-muted-foreground text-sm">{t("loading")}</p>
        ) : empty ? (
          <p className="text-muted-foreground text-sm">{emptyText}</p>
        ) : (
          children
        )}
      </div>
      <TimezoneNote orgTimeZone={orgTimeZone} />
    </>
  );
}
