"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toastRefusal } from "@/features/billing/refusal-toast";
import { patchService } from "@/features/scheduling/actions";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import { cn } from "@/lib/utils";

/* Who offers this service, as pills that save on click — the dialog's
   checklist with no dialog, form or Save (member-services.tsx, from the
   other side). The pill moves at once and snaps back if the action refuses.
   The WHOLE roster is here, deactivated people included: their link survives
   a deactivation, and a set that only listed active people would silently
   drop it on the next click. */
export function ServiceStaff({
  serviceId,
  staffIds,
  staff,
}: {
  serviceId: string;
  staffIds: string[];
  staff: StaffRow[];
}) {
  const tCommon = useTranslations("common");
  const [, startTransition] = React.useTransition();
  const [ids, setIds] = React.useOptimistic(staffIds);

  const toggle = (id: string) => {
    const next = ids.includes(id) ? ids.filter((s) => s !== id) : [...ids, id];
    startTransition(async () => {
      setIds(next);
      const result = await patchService({ id: serviceId, staffIds: next });
      if (!result.ok) toastRefusal(result.error, result.upgrade);
    });
  };

  return (
    <ul className="flex flex-wrap gap-1.5">
      {staff.map((person) => {
        const on = ids.includes(person.id);
        return (
          <li key={person.id}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => toggle(person.id)}
              className={cn(
                "ease-strong flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium outline-none transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-ring/30",
                on
                  ? "border-transparent bg-secondary text-foreground"
                  : "border-border text-muted-foreground hover:bg-accent",
                !person.active && "opacity-60",
              )}
            >
              <span
                aria-hidden
                style={{ background: on ? person.color : undefined }}
                className={cn("size-1.5 rounded-full", on ? undefined : "bg-border")}
              />
              {person.name}
              {!person.active ? <span className="text-subtle">· {tCommon("inactive")}</span> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
