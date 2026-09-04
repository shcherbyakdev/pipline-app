"use client";

import { useTranslations } from "next-intl";
import * as React from "react";
import Link from "next/link";
import { toastRefusal } from "@/features/billing/refusal-toast";
import { setOfferingActive } from "@/features/rentals/actions";
import { Switch } from "@/components/ui/switch";
import type { OfferingRow } from "@/features/rentals/queries";
import { formatDurationLabel } from "@/features/rentals/hourly";
import { formatOfferingPrice } from "@/features/rentals/pricing";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/* Shared column template so the header row and every space row align:
   Space | Type | Units | Price | bookable — the Team page's table grammar
   (staff-list.tsx). Fixed tracks only fit from lg: up; below that the row
   keeps the stacked layout. */
const gridCols =
  "lg:grid lg:grid-cols-[minmax(0,1.6fr)_80px_70px_minmax(0,1fr)_56px] lg:items-center lg:gap-3";

function Row({ offering, currency }: { offering: OfferingRow; currency: string }) {
  const t = useTranslations("spaces");
  const tc = useTranslations("common");
  const tu = useTranslations("public.units");
  const [, startTransition] = React.useTransition();
  // The switch moves the moment it's clicked and snaps back on its own if
  // the action fails (staff-list.tsx idiom).
  const [active, setActive] = React.useOptimistic(offering.active);
  const priceLabel = formatOfferingPrice(offering, currency, tu);
  const modeLabel = t(`mode.${offering.rangeMode}`);
  const schedule =
    offering.rangeMode === "hours"
      ? t("schedule.hours", {
          min: formatDurationLabel(offering.minDurationMin!, tu),
          max: formatDurationLabel(offering.maxDurationMin!, tu),
          step: offering.slotIncrementMin!,
        })
      : t(`schedule.${offering.rangeMode}`, { start: offering.startTime!, end: offering.endTime! });

  const onToggle = (next: boolean) => {
    startTransition(async () => {
      setActive(next);
      const result = await setOfferingActive({ id: offering.id, active: next });
      if (!result.ok) toastRefusal(result.error, result.upgrade);
    });
  };

  return (
    <li
      role="row"
      className={cn(
        "relative flex flex-col gap-2 rounded-lg px-3 py-2 hover:bg-muted/50 has-[a:focus-visible]:bg-muted/50",
        gridCols,
      )}
    >
      <div role="cell" className="min-w-0 max-lg:pr-12">
        <div className="flex items-center gap-2">
          {/* Stretched link (staff-list.tsx): the name is the row's one link
              and its ::after covers the whole row; the switch sits above the
              overlay (z-10) and keeps its own click. */}
          <Link
            href={`/rentals/${offering.id}`}
            className="truncate text-[13px] font-medium outline-none after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:after:ring-3 focus-visible:after:ring-ring/30"
          >
            {offering.name}
          </Link>
          <span className="lg:hidden">
            <Badge variant="outline">{modeLabel}</Badge>
          </span>
          {!offering.active ? <Badge variant="outline">{tc("inactive")}</Badge> : null}
          {/* An active space with no active unit is invisible on the public
              page (listPublicOfferings) — say so where the owner is looking. */}
          {offering.active && offering.activeUnitCount === 0 ? (
            <Badge variant="outline">{t("notBookable")}</Badge>
          ) : null}
        </div>
        <p className="text-muted-foreground truncate text-xs">{schedule}</p>
      </div>
      <span role="cell" className="max-lg:hidden">
        <Badge variant="outline">{modeLabel}</Badge>
      </span>
      {/* A space is one bookable thing until it's split; only then is the
          count news. */}
      <span role="cell" className="text-muted-foreground text-xs tabular-nums max-lg:hidden">
        {offering.unitCount > 1 ? offering.unitCount : "—"}
      </span>
      <span role="cell" className="text-muted-foreground truncate text-xs max-lg:hidden">
        {priceLabel ?? "—"}
      </span>
      {/* Below lg the columns collapse into one meta line. */}
      <p role="cell" className="text-muted-foreground text-xs lg:hidden">
        {[offering.unitCount > 1 ? t("list.unitCount", { count: offering.unitCount }) : null, priceLabel]
          .filter(Boolean)
          .join(" · ") || "—"}
      </p>
      <div role="cell" className="flex lg:justify-end">
        <Switch
          checked={active}
          onCheckedChange={onToggle}
          aria-label={t("list.bookableAria", { name: offering.name })}
          className="z-10 max-lg:absolute max-lg:top-2.5 max-lg:right-3 lg:relative"
        />
      </div>
    </li>
  );
}

export function OfferingsList({ offerings, currency }: { offerings: OfferingRow[]; currency: string }) {
  const t = useTranslations("spaces");
  return (
    // ARIA table grammar on the styled rows so type, units and price read in
    // their columns; the layout stays the responsive grid.
    <div role="table" aria-label={t("nav")} className="flex flex-col gap-3">
      <div
        role="row"
        className={cn(
          "hidden border-b px-3 pb-2 text-xs font-medium text-muted-foreground",
          gridCols,
        )}
      >
        <span role="columnheader">{t("field")}</span>
        <span role="columnheader">{t("list.type")}</span>
        <span role="columnheader">{t("units.title")}</span>
        <span role="columnheader">{t("list.price")}</span>
        <span role="columnheader">
          <span className="sr-only">{t("list.bookable")}</span>
        </span>
      </div>
      <ol role="rowgroup" className="flex flex-col max-lg:divide-y">
        {offerings.map((offering) => (
          <Row key={offering.id} offering={offering} currency={currency} />
        ))}
      </ol>
    </div>
  );
}
