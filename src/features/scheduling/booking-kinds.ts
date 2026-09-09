import type { DayWindow } from "@/features/scheduling/day-windows";
import type { OfferingOption } from "@/features/rentals/offering-option";

/* What a walk-in is for. One entry point, the kind is a field (admin IA
   spec §2, ruling 5): these helpers decide the picker's label, what it
   starts on, and what a drag on the week grid pre-fills. Pure. */
export type BookingKind = "service" | "space";
export type KindSelection = { kind: BookingKind; id: string };

export type Initial =
  | {
      kind: "service";
      serviceId?: string;
      date: string;       // org-local YYYY-MM-DD
      startMin: number;   // org-local minutes since midnight (snapped)
      dragEndMin: number; // where the selection ended on the grid
      dragged: boolean;   // a real drag pins the length; a click follows the picked service
      windows: DayWindow[]; // effective windows for `date` — the outside-hours hint only
    }
  | { kind: "space"; offeringId?: string; unitId?: string | null; date?: string; endDate?: string };

type Row = { id: string };

/** The picker's label as a message key (root namespace); the dialog renders it. */
export function pickerLabel(hasSpaces: boolean): "spaces.field" | "appointments.field" {
  return hasSpaces ? "spaces.field" : "appointments.field";
}

export function canCreateWalkIn(services: readonly Row[], spaces: readonly Row[]): boolean {
  return services.length > 0 || spaces.length > 0;
}

/** A prefilled id wins when it is really listed; else first service, else first space. */
export function defaultSelection(
  services: readonly Row[],
  spaces: readonly Row[],
  initial?: Initial,
): KindSelection | null {
  if (initial?.kind === "service" && initial.serviceId && services.some((s) => s.id === initial.serviceId)) {
    return { kind: "service", id: initial.serviceId };
  }
  if (initial?.kind === "space" && initial.offeringId && spaces.some((o) => o.id === initial.offeringId)) {
    return { kind: "space", id: initial.offeringId };
  }
  if (services[0]) return { kind: "service", id: services[0].id };
  if (spaces[0]) return { kind: "space", id: spaces[0].id };
  return null;
}

/** The picker's option values are `service:<id>` / `space:<id>`. */
export function parseSelection(value: string): KindSelection | null {
  const i = value.indexOf(":");
  if (i < 0) return null;
  const kind = value.slice(0, i);
  const id = value.slice(i + 1);
  return (kind === "service" || kind === "space") && id ? { kind, id } : null;
}

export function selectionValue(sel: KindSelection): string {
  return `${sel.kind}:${sel.id}`;
}

/* Drag on the week grid: an appointment when the org sells any (the drag's
   date, start and length carry over); else the first hourly space with the
   day prefilled; else nothing — the popover then shows no "New booking".
   `preferSpace` (the week's space scope — bookings-scope.ts scopedSpace)
   wins outright: a drag on a space's week books that space. */
export function dragInitial(
  sel: { date: string; startMin: number; endMin: number; dragged?: boolean },
  services: readonly Row[],
  spaces: readonly OfferingOption[],
  windows: DayWindow[],
  preferSpace?: string | null,
): Initial | null {
  if (preferSpace) return { kind: "space", offeringId: preferSpace, date: sel.date };
  if (services.length > 0) {
    return {
      kind: "service",
      date: sel.date,
      startMin: sel.startMin,
      dragEndMin: sel.endMin,
      dragged: sel.dragged ?? true,
      windows,
    };
  }
  const hourly = spaces.find((o) => o.rangeMode === "hours");
  if (hourly) return { kind: "space", offeringId: hourly.id, date: sel.date };
  return null;
}
