"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toastRefusal } from "@/features/billing/refusal-toast";
import { setServiceActive } from "@/features/scheduling/actions";
import { Switch } from "@/components/ui/switch";
import type { ServiceRow } from "@/features/scheduling/queries";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/* Shared column template so the header row and every service row align:
   Service | Duration | Price | bookable — the Team page's table grammar
   (staff-list.tsx). Fixed tracks only fit from lg: up; below that the row
   keeps the stacked layout. */
const gridCols =
  "lg:grid lg:grid-cols-[minmax(0,1.6fr)_110px_minmax(0,1fr)_56px] lg:items-center lg:gap-3";

function Row({ service, staff }: { service: ServiceRow; staff: StaffRow[] }) {
  const t = useTranslations("services");
  const tCommon = useTranslations("common");
  const tUnits = useTranslations("public.units");
  const [, startTransition] = React.useTransition();
  // The switch moves the moment it's clicked and snaps back on its own if
  // the action fails (staff-list.tsx idiom).
  const [active, setActive] = React.useOptimistic(service.active);
  // Solo rule: one active person means the count is always "1 of 1" — noise,
  // so the hint only exists once there is a team to narrow.
  const activeStaff = staff.filter((s) => s.active);
  const assigned = activeStaff.filter((s) => service.staffIds.includes(s.id)).length;
  const team =
    activeStaff.length < 2 ? null : assigned === 0 ? t("noTeam") : t("teamCount", { assigned, total: activeStaff.length });
  const duration = tUnits("minutes", { count: service.durationMin });

  const onToggle = (next: boolean) => {
    startTransition(async () => {
      setActive(next);
      const result = await setServiceActive({ id: service.id, active: next });
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
            href={`/services/${service.id}`}
            className="truncate text-[13px] font-medium outline-none after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:after:ring-3 focus-visible:after:ring-ring/30"
          >
            {service.name}
          </Link>
          {!service.active ? <Badge variant="outline">{tCommon("inactive")}</Badge> : null}
        </div>
        {team ? <p className="text-muted-foreground truncate text-xs">{team}</p> : null}
      </div>
      <span role="cell" className="text-muted-foreground text-xs tabular-nums max-lg:hidden">
        {duration}
      </span>
      <span role="cell" className="text-muted-foreground truncate text-xs max-lg:hidden">
        {service.priceLabel ?? "—"}
      </span>
      {/* Below lg the columns collapse into one meta line. */}
      <p role="cell" className="text-muted-foreground text-xs lg:hidden">
        {service.priceLabel ? `${duration} · ${service.priceLabel}` : duration}
      </p>
      <div role="cell" className="flex lg:justify-end">
        <Switch
          checked={active}
          onCheckedChange={onToggle}
          aria-label={t("bookableSwitch", { name: service.name })}
          className="z-10 max-lg:absolute max-lg:top-2.5 max-lg:right-3 lg:relative"
        />
      </div>
    </li>
  );
}

export function ServicesList({ services, staff }: { services: ServiceRow[]; staff: StaffRow[] }) {
  const t = useTranslations("services");
  return (
    // ARIA table grammar on the styled rows so duration and price read in
    // their columns; the layout stays the responsive grid.
    <div role="table" aria-label={t("table")} className="flex flex-col gap-3">
      <div
        role="row"
        className={cn(
          "hidden border-b px-3 pb-2 text-xs font-medium text-muted-foreground",
          gridCols,
        )}
      >
        <span role="columnheader">{t("columns.service")}</span>
        <span role="columnheader">{t("columns.duration")}</span>
        <span role="columnheader">{t("columns.price")}</span>
        <span role="columnheader">
          <span className="sr-only">{t("columns.actions")}</span>
        </span>
      </div>
      <ol role="rowgroup" className="flex flex-col max-lg:divide-y">
        {services.map((service) => (
          <Row key={service.id} service={service} staff={staff} />
        ))}
      </ol>
    </div>
  );
}
