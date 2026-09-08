"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CANCEL_POLICY_MAX_TIERS, formatCancelWindow, type CancelPolicy } from "@/features/rentals/cancel-policy";
import type { RangeMode } from "@/features/rentals/range";

/** A day closer than the smallest existing lead, skipping any lead already
    taken (adding on top of a collision would make `cancelPolicySchema`
    refuse the whole save — review finding 2). `null` = nothing free to add
    (0 is already a tier, or 0 is the only free lead and it's taken too). */
function nextTierLead(existingLeads: Set<number>, smallest: number | null, rangeMode: RangeMode): number | null {
  if (smallest === null) return rangeMode === "hours" ? 2880 : 4320;
  if (smallest === 0) return null; // nothing below "up to the start"
  let lead = Math.max(0, smallest - 1440);
  while (existingLeads.has(lead) && lead > 0) lead -= 1440;
  return existingLeads.has(lead) ? null : lead;
}

/* S3: the tiers of a space's cancellation policy (spec §Admin). Controlled:
   the form owns the value and posts it as one `cancelPolicy` array. Leads
   are typed in hours (hourly spaces) or days (stays) and stored in minutes,
   the way the old single window was. Rows are kept in the order typed;
   the schema sorts them on save. Row idiom: pricing-rules-editor. */
export function CancelPolicyEditor({
  value, onChange, rangeMode,
}: {
  value: CancelPolicy;
  onChange: (next: CancelPolicy) => void;
  rangeMode: RangeMode;
}) {
  const t = useTranslations("spaces.form");
  const tu = useTranslations("public.units");
  const unit = rangeMode === "hours" ? 60 : 1440;
  // The schema's own cap (527040 min = 366 days) in the field's own unit.
  const maxLead = rangeMode === "hours" ? 8784 : 366;
  const set = (i: number, patch: Partial<CancelPolicy[number]>) =>
    onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const smallest = value.length ? Math.min(...value.map((x) => x.beforeMin)) : null;
  const nextLead = nextTierLead(new Set(value.map((x) => x.beforeMin)), smallest, rangeMode);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="flex flex-col">
        <span className="text-sm font-medium">{t("cancelPolicy")}</span>
        <span className="text-muted-foreground text-xs">{t("cancelPolicyHint")}</span>
      </legend>
      {value.map((tier, i) => (
        <div key={i} className="grid grid-cols-[auto_1fr_auto_1fr_auto] items-center gap-2">
          <Input
            aria-label={t("tierLeadAria", { n: i + 1 })}
            type="number"
            min={0}
            max={maxLead}
            step={rangeMode === "hours" ? 0.5 : 1}
            className="w-20"
            value={tier.beforeMin / unit}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) set(i, { beforeMin: Math.max(0, Math.round(n * unit)) });
            }}
          />
          <span className="text-muted-foreground text-xs">
            {tier.beforeMin === 0 ? t("tierUpToStart") : rangeMode === "hours" ? t("tierBeforeHours") : t("tierBeforeDays")}
          </span>
          <Input
            aria-label={t("tierFeeAria", { n: i + 1 })}
            type="number"
            min={0}
            max={100}
            className="w-16"
            value={tier.feePct}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) set(i, { feePct: Math.min(100, Math.max(0, Math.round(n))) });
            }}
          />
          <span className="text-muted-foreground text-xs">{t("tierFee")}</span>
          <Button type="button" variant="ghost" size="icon" aria-label={t("tierRemove", { n: i + 1 })} className="shrink-0"
            onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <X className="size-4" />
          </Button>
        </div>
      ))}
      {smallest !== null && smallest > 0 ? (
        <p className="text-muted-foreground text-xs">{t("tierAfter", { lead: formatCancelWindow(smallest, tu) })}</p>
      ) : null}
      {value.length < CANCEL_POLICY_MAX_TIERS && nextLead !== null ? (
        <Button type="button" variant="ghost" size="sm" className="self-start"
          // First tier: 48 h (hourly) / 3 days (stays) free; each next one a
          // day closer at 50%, skipping any lead already taken. Defaults
          // only — the studio edits the numbers.
          onClick={() => onChange([...value, { beforeMin: nextLead, feePct: value.length === 0 ? 0 : 50 }])}>
          {t("tierAdd")}
        </Button>
      ) : null}
    </fieldset>
  );
}
