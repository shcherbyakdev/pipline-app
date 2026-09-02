"use client";

import { useTranslations } from "next-intl";
import type { PublicUnit } from "@/lib/booking/public";

// The native-<select> idiom shared by the booking forms.
const selectClass = "border-input h-9 rounded-md border bg-transparent px-3 text-sm";

// Which unit a stay lands on. "" is auto — the RPC keeps the current unit
// when it's still free (reschedule) or takes the first free one in display
// order. Only units the engine says are free for the chosen dates are
// offered; while availability is still loading (`freeUnitIds === null`) the
// whole control is disabled rather than listing units that may not be free.
export function UnitSelect({
  units,
  freeUnitIds,
  value,
  onChange,
  keepUnitId = null,
  keepUnitName = null,
  id,
}: {
  units: PublicUnit[];
  freeUnitIds: string[] | null;
  value: string | null;
  onChange: (value: string | null) => void;
  keepUnitId?: string | null;
  keepUnitName?: string | null;
  id: string;
}) {
  const t = useTranslations("public.manage");
  const options = freeUnitIds === null ? units : units.filter((u) => freeUnitIds.includes(u.id));
  return (
    <select
      id={id}
      className={selectClass}
      value={value ?? ""}
      disabled={freeUnitIds === null}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
    >
      <option value="">
        {keepUnitId && keepUnitName ? t("unitAutoKeep", { name: keepUnitName }) : t("unitAuto")}
      </option>
      {options.map((u) => (
        <option key={u.id} value={u.id}>
          {u.active ? u.name : t("unitInactive", { name: u.name })}
        </option>
      ))}
    </select>
  );
}
