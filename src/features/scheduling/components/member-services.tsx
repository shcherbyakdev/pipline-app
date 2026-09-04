"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toastRefusal } from "@/features/billing/refusal-toast";
import { updateStaff } from "@/features/scheduling/staff-actions";
import type { ServiceRow } from "@/features/scheduling/queries";
import { cn } from "@/lib/utils";

/* What the person offers, as pills that save on click — the dialog's
   checklist with no dialog, form or Save. The pill moves at once and snaps
   back if the action refuses. */
export function MemberServices({
  staffId,
  serviceIds,
  services,
}: {
  staffId: string;
  serviceIds: string[];
  services: ServiceRow[];
}) {
  const t = useTranslations("team");
  const tCommon = useTranslations("common");
  const [, startTransition] = React.useTransition();
  const [ids, setIds] = React.useOptimistic(serviceIds);

  if (services.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("servicesCount", { count: 0 })}</p>;
  }

  const toggle = (id: string) => {
    const next = ids.includes(id) ? ids.filter((s) => s !== id) : [...ids, id];
    startTransition(async () => {
      setIds(next);
      const result = await updateStaff({ id: staffId, serviceIds: next });
      if (!result.ok) toastRefusal(result.error, result.upgrade);
    });
  };

  return (
    <ul className="flex flex-wrap gap-1.5">
      {services.map((s) => {
        const on = ids.includes(s.id);
        return (
          <li key={s.id}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => toggle(s.id)}
              className={cn(
                "ease-strong flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium outline-none transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-ring/30",
                on
                  ? "border-transparent bg-secondary text-foreground"
                  : "border-border text-muted-foreground hover:bg-accent",
                !s.active && "opacity-60",
              )}
            >
              <span aria-hidden className={cn("size-1.5 rounded-full", on ? "bg-foreground" : "bg-border")} />
              {s.name}
              {!s.active ? <span className="text-subtle">· {tCommon("inactive")}</span> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
