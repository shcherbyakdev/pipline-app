"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { deleteOffering } from "@/features/rentals/actions";
import type { OfferingRow } from "@/features/rentals/queries";
import { formatDurationLabel } from "@/features/rentals/hourly";
import { formatOfferingPrice } from "@/features/rentals/pricing";
import { bookingLink } from "@/lib/booking/url";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { CopyLinkButton, type LinkBase } from "@/components/copy-link-button";
import { cn } from "@/lib/utils";
import { OfferingDialog } from "./offering-dialog";

function Row({
  offering,
  currency,
  linkBase,
}: {
  offering: OfferingRow;
  currency: string;
  linkBase: LinkBase | null;
}) {
  const [pending, startTransition] = React.useTransition();
  const hourly = offering.rangeMode === "hours";
  const nightly = offering.rangeMode === "nights";
  const priceLabel = formatOfferingPrice(offering, currency);

  const onDelete = () => {
    startTransition(async () => {
      const result = await deleteOffering({ id: offering.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Deleted");
    });
  };

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <Link
            href={`/rentals/${offering.id}`}
            className="truncate text-sm font-medium hover:underline"
          >
            {offering.name}
          </Link>
          <Badge variant="outline">{hourly ? "Hourly" : nightly ? "Nightly" : "Daily"}</Badge>
          {!offering.active ? <Badge variant="outline">Inactive</Badge> : null}
        </div>
        <p className="text-muted-foreground text-xs">
          {offering.unitCount} {offering.unitCount === 1 ? "unit" : "units"}
        </p>
        <p className="text-muted-foreground text-xs">
          {hourly
            ? `${formatDurationLabel(offering.minDurationMin!)}–${formatDurationLabel(offering.maxDurationMin!)} · every ${offering.slotIncrementMin} min`
            : nightly
              ? `check-in ${offering.startTime} · check-out ${offering.endTime}`
              : `pickup ${offering.startTime} · return ${offering.endTime}`}
        </p>
        {priceLabel ? <p className="text-muted-foreground text-xs">{priceLabel}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
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
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Units
        </Link>
        <OfferingDialog offering={offering} currency={currency} />
        <Button size="sm" variant="outline" onClick={onDelete} disabled={pending}>
          {pending ? "Deleting…" : "Delete"}
        </Button>
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
    <ol className="flex flex-col gap-2">
      {offerings.map((offering) => (
        <Row key={offering.id} offering={offering} currency={currency} linkBase={linkBase} />
      ))}
    </ol>
  );
}
