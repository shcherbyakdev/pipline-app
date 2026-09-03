"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toastRefusal } from "@/features/billing/refusal-toast";
import { Switch } from "@/components/ui/switch";
import { setStaffActive } from "@/features/scheduling/staff-actions";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import { bookingPath } from "@/lib/booking/url";
import { initials } from "@/features/scheduling/staff-slug";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/* Shared column template so the header row and every member row align:
   Name | Booking link | Role | bookable. The fixed tracks (110px + 56px)
   only fit from lg: up — below that the row keeps the stacked layout, or
   the fr columns collapse to zero width and the headers pile up. */
const gridCols =
  "lg:grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_110px_56px] lg:items-center lg:gap-3";

function Row({
  staff,
  handle,
  isPublic,
}: {
  staff: StaffRow;
  handle: string | null;
  /** On the plan's public roster (Team page passed the real one)? A person
      beyond the cap has a 404ing URL, so their link isn't offered either. */
  isPublic: boolean;
}) {
  const t = useTranslations("team");
  const tCommon = useTranslations("common");
  const [, startTransition] = React.useTransition();
  // The switch moves the moment it's clicked and snaps back on its own if the
  // action fails (a deactivation blocked by the offboarding guard).
  const [active, setActive] = React.useOptimistic(staff.active);

  // A deactivated person's booking URL 404s, so their link isn't offered —
  // same for a person the plan keeps off the public roster.
  const path = handle && staff.active && isPublic ? bookingPath(handle, staff.slug) : null;
  const overPlanLimit = staff.active && !isPublic;

  const onToggle = (next: boolean) => {
    startTransition(async () => {
      setActive(next);
      const result = await setStaffActive({ id: staff.id, active: next });
      if (!result.ok) toastRefusal(result.error, result.upgrade);
    });
  };

  // ponytail: staff have no logins yet (user_id reserved), so "role" is
  // derived — the creator's seeded row is always sort_order 0 and it is
  // never user-editable. Replace with a real role once invites land.
  const role =
    staff.sortOrder === 0 ? (
      <Badge variant="secondary">{t("owner")}</Badge>
    ) : (
      <span className="text-muted-foreground text-xs">{t("member")}</span>
    );

  return (
    <li
      role="row"
      className={cn(
        "relative flex flex-col gap-2 rounded-lg px-3 py-2 hover:bg-muted/50 has-[a:focus-visible]:bg-muted/50",
        gridCols
      )}
    >
      {/* Below lg the switch is pinned top-right next to the name (the
          absolute variant wins over the base `relative`), so the stacked
          row reads name → link → switch instead of leaving the switch
          alone on a wrapped line. */}
      <div role="cell" className="flex min-w-0 items-center gap-3 max-lg:pr-12">
        <span
          aria-hidden
          style={{ background: staff.color }}
          className="flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium text-white"
        >
          {initials(staff.name)}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {/* Stretched link: the name is the row's one link and its ::after
                covers the whole row, so a click anywhere opens the person
                without nesting the switch inside an <a>. The switch sits
                above the overlay (z-10) and keeps its own click. */}
            <Link
              href={`/team/${staff.id}`}
              className="truncate text-[13px] font-medium outline-none after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:after:ring-3 focus-visible:after:ring-ring/30"
            >
              {staff.name}
            </Link>
            <span className="lg:hidden">{role}</span>
            {!staff.active ? <Badge variant="outline">{tCommon("inactive")}</Badge> : null}
            {overPlanLimit ? (
              <Badge variant="destructive" title={t("overLimitTitle")}>
                {t("overLimit")}
                <span className="sr-only">{t("overLimitSr")}</span>
              </Badge>
            ) : null}
          </div>
          <p className="text-muted-foreground truncate text-xs">
            {t("servicesCount", { count: staff.serviceIds.length })}
          </p>
        </div>
      </div>
      <p
        role="cell"
        className={cn(
          "text-muted-foreground truncate font-mono text-xs max-lg:pl-9",
          !path && "max-lg:hidden"
        )}
      >
        {path ?? "—"}
      </p>
      <span role="cell" className="max-lg:hidden">{role}</span>
      <div role="cell" className="flex lg:justify-end">
        <Switch
          checked={active}
          onCheckedChange={onToggle}
          aria-label={t("bookableSwitch", { name: staff.name })}
          className="z-10 max-lg:absolute max-lg:top-2.5 max-lg:right-3 lg:relative"
        />
      </div>
    </li>
  );
}

export function StaffList({
  staff,
  handle,
  publicStaffIds,
}: {
  staff: StaffRow[];
  handle: string | null;
  /** The plan's public roster ids; null = no cap applies, flag nobody. */
  publicStaffIds: string[] | null;
}) {
  const t = useTranslations("team");
  const tCommon = useTranslations("common");
  return (
    <div className="flex flex-col gap-3">
      {handle ? null : (
        <p className="text-muted-foreground text-sm">
          {t.rich("noHandle", {
            link: (chunks) => (
              <Link href="/booking-page" className="underline underline-offset-3 hover:text-foreground">
                {chunks}
              </Link>
            ),
          })}
        </p>
      )}
      {/* ARIA table grammar on the styled rows so "Owner" and the link read
          in their columns; the layout stays the responsive grid. */}
      <div role="table" aria-label={t("table")} className="flex flex-col gap-3">
        <div
          role="row"
          className={cn(
            "hidden border-b px-3 pb-2 text-xs font-medium text-muted-foreground",
            gridCols
          )}
        >
          <span role="columnheader">{tCommon("name")}</span>
          <span role="columnheader">{t("columns.link")}</span>
          <span role="columnheader">{t("columns.role")}</span>
          <span role="columnheader">
            <span className="sr-only">{t("columns.bookable")}</span>
          </span>
        </div>
        <ol role="rowgroup" className="flex flex-col max-lg:divide-y">
          {staff.map((person) => (
            <Row
              key={person.id}
              staff={person}
              handle={handle}
              isPublic={publicStaffIds === null || publicStaffIds.includes(person.id)}
            />
          ))}
        </ol>
      </div>
    </div>
  );
}
