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
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar";
import { initials } from "@/features/scheduling/staff-slug";
import { cn } from "@/lib/utils";

/* Shared column template so the header row and every service row align:
   Service | Duration | Price | Team | bookable — the Team page's table
   grammar (staff-list.tsx). Fixed tracks only fit from lg: up; below that
   the row keeps the stacked layout. The Team column exists only once there
   is a team: on a solo org every row would read "1 of 1" (the solo rule).*/
const gridCols = (isTeam: boolean) =>
  cn(
    "lg:grid lg:items-center lg:gap-3",
    isTeam
      ? "lg:grid-cols-[minmax(0,1.6fr)_110px_minmax(0,1fr)_120px_56px]"
      : "lg:grid-cols-[minmax(0,1.6fr)_110px_minmax(0,1fr)_56px]",
  );

// Four faces, then a count — the rest of the roster is a number, not a
// smaller disc.
const MAX_FACES = 4;

/* Who offers a service, in the Team page's colours: overlapping discs, the
   overflow as "+n". Non-interactive on purpose — the row's one link is the
   service — and labelled as a whole, so a screen reader reads the names
   instead of a pile of initials. */
function StaffStack({ people }: { people: StaffRow[] }) {
  const faces = people.length > MAX_FACES ? people.slice(0, MAX_FACES - 1) : people;
  const rest = people.length - faces.length;
  return (
    // Tighter overlap than the kit's default: at size-6 the -space-x-2 it
    // ships for photos eats the second letter of every initial.
    <AvatarGroup role="img" aria-label={people.map((p) => p.name).join(", ")} className="-space-x-1">
      {faces.map((p) => (
        // after:hidden: the kit's inner hairline is for photos; on a solid
        // colour it only muddies the edge.
        <Avatar key={p.id} size="sm" className="after:hidden">
          <AvatarFallback style={{ background: p.color }} className="text-[10px] font-medium text-white">
            {initials(p.name)}
          </AvatarFallback>
        </Avatar>
      ))}
      {rest > 0 ? <AvatarGroupCount className="text-[10px]">+{rest}</AvatarGroupCount> : null}
    </AvatarGroup>
  );
}

function Row({ service, people }: { service: ServiceRow; people: StaffRow[] }) {
  const t = useTranslations("services");
  const tCommon = useTranslations("common");
  const tUnits = useTranslations("public.units");
  const [, startTransition] = React.useTransition();
  // The switch moves the moment it's clicked and snaps back on its own if
  // the action fails (staff-list.tsx idiom).
  const [active, setActive] = React.useOptimistic(service.active);
  const isTeam = people.length > 1;
  const assigned = people.filter((s) => service.staffIds.includes(s.id));
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
        gridCols(isTeam),
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
      {isTeam ? (
        <div role="cell" className="flex min-w-0">
          {assigned.length === 0 ? (
            <span className="text-muted-foreground text-xs">
              —<span className="sr-only">{t("noTeam")}</span>
            </span>
          ) : (
            <StaffStack people={assigned} />
          )}
        </div>
      ) : null}
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
  // A deactivated person is off the stack; the whole roster still arrives so
  // the page can count what a service would lose.
  const people = staff.filter((s) => s.active);
  const isTeam = people.length > 1;
  return (
    // ARIA table grammar on the styled rows so duration and price read in
    // their columns; the layout stays the responsive grid.
    <div role="table" aria-label={t("table")} className="flex flex-col gap-3">
      <div
        role="row"
        className={cn(
          "hidden border-b px-3 pb-2 text-xs font-medium text-muted-foreground",
          gridCols(isTeam),
        )}
      >
        <span role="columnheader">{t("columns.service")}</span>
        <span role="columnheader">{t("columns.duration")}</span>
        <span role="columnheader">{t("columns.price")}</span>
        {isTeam ? <span role="columnheader">{t("columns.team")}</span> : null}
        <span role="columnheader">
          <span className="sr-only">{t("columns.actions")}</span>
        </span>
      </div>
      <ol role="rowgroup" className="flex flex-col max-lg:divide-y">
        {services.map((service) => (
          <Row key={service.id} service={service} people={people} />
        ))}
      </ol>
    </div>
  );
}
