"use client";

import { useTranslations } from "next-intl";
import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { toastRefusal } from "@/features/billing/refusal-toast";
import { deleteOffering, setOfferingActive } from "@/features/rentals/actions";
import { Switch } from "@/components/ui/switch";
import type { OfferingRow } from "@/features/rentals/queries";
import { formatDurationLabel } from "@/features/rentals/hourly";
import { formatOfferingPrice } from "@/features/rentals/pricing";
import { bookingLink } from "@/lib/booking/url";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { CopyLinkButton, type LinkBase } from "@/components/copy-link-button";
import { SPACES } from "@/features/orgs/vocab";
import { cn } from "@/lib/utils";
import { OfferingDialog } from "./offering-dialog";

/* Shared column template so the header row and every space row align:
   Space | Type | Units | Price | actions — the Team page's table grammar
   (staff-list.tsx). Fixed tracks only fit from lg: up; below that the row
   keeps the stacked layout. */
const gridCols =
  "lg:grid lg:grid-cols-[minmax(0,1.6fr)_80px_70px_minmax(0,1fr)_390px] lg:items-center lg:gap-3";

function Row({
  offering,
  currency,
  linkBase,
}: {
  offering: OfferingRow;
  currency: string;
  linkBase: LinkBase | null;
}) {
  const tu = useTranslations("public.units");
  const [pending, startTransition] = React.useTransition();
  // Delete is irreversible, so it takes two clicks — the same inline
  // Confirm/Keep step services-list.tsx and bookings-list.tsx use.
  const [confirming, setConfirming] = React.useState(false);
  // The switch moves the moment it's clicked and snaps back on its own if
  // the action fails (staff-list.tsx idiom).
  const [active, setActive] = React.useOptimistic(offering.active);
  const hourly = offering.rangeMode === "hours";
  const nightly = offering.rangeMode === "nights";
  const priceLabel = formatOfferingPrice(offering, currency, tu);
  const schedule = hourly
    ? `${formatDurationLabel(offering.minDurationMin!, tu)}–${formatDurationLabel(offering.maxDurationMin!, tu)} · every ${offering.slotIncrementMin} min`
    : nightly
      ? `check-in ${offering.startTime} · check-out ${offering.endTime}`
      : `pickup ${offering.startTime} · return ${offering.endTime}`;

  const onToggle = (next: boolean) => {
    startTransition(async () => {
      setActive(next);
      const result = await setOfferingActive({ id: offering.id, active: next });
      if (!result.ok) toastRefusal(result.error);
    });
  };

  const onDelete = () => {
    startTransition(async () => {
      const result = await deleteOffering({ id: offering.id });
      setConfirming(false);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Deleted");
    });
  };

  return (
    <li role="row" className={cn("group relative flex flex-col gap-2 rounded-lg px-3 py-2 hover:bg-muted/50", gridCols)}>
      <div role="cell" className="min-w-0 max-lg:pr-12">
        <div className="flex items-center gap-2">
          <Link
            href={`/rentals/${offering.id}`}
            className="truncate text-[13px] font-medium hover:underline"
          >
            {offering.name}
          </Link>
          <span className="lg:hidden">
            <Badge variant="outline">{hourly ? "Hourly" : nightly ? "Nightly" : "Daily"}</Badge>
          </span>
          {!offering.active ? <Badge variant="outline">Inactive</Badge> : null}
          {/* An active space with no active unit is invisible on the public
              page (listPublicOfferings) — say so where the owner is looking. */}
          {offering.active && offering.activeUnitCount === 0 ? (
            <Badge variant="outline">{SPACES.notBookable}</Badge>
          ) : null}
        </div>
        <p className="text-muted-foreground truncate text-xs">{schedule}</p>
      </div>
      <span role="cell" className="max-lg:hidden">
        <Badge variant="outline">{hourly ? "Hourly" : nightly ? "Nightly" : "Daily"}</Badge>
      </span>
      <span role="cell" className="text-muted-foreground text-xs tabular-nums max-lg:hidden">
        {offering.unitCount}
      </span>
      <span role="cell" className="text-muted-foreground truncate text-xs max-lg:hidden">
        {priceLabel ?? "—"}
      </span>
      {/* Below lg the columns collapse into one meta line. */}
      <p role="cell" className="text-muted-foreground text-xs lg:hidden">
        {offering.unitCount} {offering.unitCount === 1 ? "unit" : "units"}
        {priceLabel ? ` · ${priceLabel}` : ""}
      </p>
      <div role="cell" className="flex items-center gap-1 max-lg:flex-wrap lg:justify-end">
        {/* Row actions surface on hover/focus (always visible below lg, and
            while the delete confirm is open — it must not vanish mid-choice). */}
        <span
          className={cn(
            "flex items-center gap-1 lg:transition-opacity lg:group-focus-within:opacity-100 lg:group-hover:opacity-100",
            confirming ? "lg:opacity-100" : "lg:opacity-0",
          )}
        >
          {linkBase && offering.active ? (
            <CopyLinkButton
              url={bookingLink(linkBase.appUrl, linkBase.handle, { space: offering.id })}
              name={offering.name}
            />
          ) : null}
          {/*
            A plain styled Link, not <Button render={<Link .../>}>: base-ui's
            Button enforces button semantics on whatever it renders, and its own
            docs say links should not go through that render prop
            (programs/components/unit-row.tsx makes the same call).
          */}
          <Link
            href={`/rentals/${offering.id}`}
            className={cn(buttonVariants({ variant: "ghost", size: "xs" }))}
          >
            Units
          </Link>
          <OfferingDialog offering={offering} currency={currency} />
          {confirming ? (
            <>
              <Button size="sm" variant="destructive" onClick={onDelete} disabled={pending}>
                {pending ? "Deleting…" : "Confirm delete"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
                Keep
              </Button>
            </>
          ) : (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setConfirming(true)}
              disabled={pending}
              aria-label={`Delete ${offering.name}`}
            >
              Delete
            </Button>
          )}
        </span>
        <Switch
          checked={active}
          onCheckedChange={onToggle}
          aria-label={`${offering.name} is bookable`}
          className="max-lg:absolute max-lg:top-2.5 max-lg:right-3"
        />
      </div>
    </li>
  );
}

export function OfferingsList({
  offerings,
  currency,
  linkBase,
}: {
  offerings: OfferingRow[];
  currency: string;
  linkBase: LinkBase | null;
}) {
  return (
    // ARIA table grammar on the styled rows so type, units and price read in
    // their columns; the layout stays the responsive grid.
    <div role="table" aria-label={SPACES.nav} className="flex flex-col gap-3">
      <div
        role="row"
        className={cn(
          "hidden border-b px-3 pb-2 text-xs font-medium text-muted-foreground",
          gridCols,
        )}
      >
        <span role="columnheader">Space</span>
        <span role="columnheader">Type</span>
        <span role="columnheader">Units</span>
        <span role="columnheader">Price</span>
        <span role="columnheader">
          <span className="sr-only">Actions</span>
        </span>
      </div>
      <ol role="rowgroup" className="flex flex-col max-lg:divide-y">
        {offerings.map((offering) => (
          <Row key={offering.id} offering={offering} currency={currency} linkBase={linkBase} />
        ))}
      </ol>
    </div>
  );
}
