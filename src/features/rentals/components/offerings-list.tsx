"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { deleteOffering } from "@/features/rentals/actions";
import type { OfferingRow } from "@/features/rentals/queries";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { OfferingDialog, hhmm } from "./offering-dialog";

function Row({ offering }: { offering: OfferingRow }) {
  const [pending, startTransition] = React.useTransition();
  const nightly = offering.rangeMode === "nights";

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
          <Badge variant="outline">{nightly ? "Nightly" : "Daily"}</Badge>
          {!offering.active ? <Badge variant="outline">Inactive</Badge> : null}
        </div>
        <p className="text-muted-foreground text-xs">
          {offering.unitCount} {offering.unitCount === 1 ? "unit" : "units"}
          {offering.priceLabel ? ` · ${offering.priceLabel}` : ""}
        </p>
        <p className="text-muted-foreground text-xs">
          {nightly
            ? `check-in ${hhmm(offering.startTime)} · check-out ${hhmm(offering.endTime)}`
            : `pickup ${hhmm(offering.startTime)} · return ${hhmm(offering.endTime)}`}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
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
        <OfferingDialog offering={offering} />
        <Button size="sm" variant="outline" onClick={onDelete} disabled={pending}>
          {pending ? "Deleting…" : "Delete"}
        </Button>
      </div>
    </li>
  );
}

export function OfferingsList({ offerings }: { offerings: OfferingRow[] }) {
  return (
    <ol className="flex flex-col gap-2">
      {offerings.map((offering) => (
        <Row key={offering.id} offering={offering} />
      ))}
    </ol>
  );
}
