// The pageSections entitlement rule — pure, so the palette (client), the
// publish action (server) and the tests share one answer.
import type { PlanLimits } from "@/lib/billing/plans";
import type { OrgMode } from "@/features/orgs/mode";
import type { BookingChannel, PageDocument, Section, SectionType } from "./schema";
import { ADDABLE_TYPES, SECTION_META, bookingMeta } from "./defaults";
import { canAddSection, type Verdict } from "./doc-ops";

export const BASIC_SECTION_TYPES: ReadonlySet<SectionType> = new Set<SectionType>(["header", "booking", "about", "links"]);

export function sectionAllowed(type: SectionType, ent: Pick<PlanLimits, "pageSections">): boolean {
  return ent.pageSections === "all" || BASIC_SECTION_TYPES.has(type);
}

/** Visible sections the plan does not allow — what blocks Publish. */
export function gatedVisibleSections(doc: PageDocument, ent: Pick<PlanLimits, "pageSections">): Section[] {
  return doc.sections.filter((s) => !s.hidden && !sectionAllowed(s.type, ent));
}

/** The palette for an org: a channel it doesn't sell gets no section. */
export function addableTypes(mode: OrgMode): SectionType[] {
  return ADDABLE_TYPES.filter((t) => {
    if (t === "spaces") return mode.offersRentals;
    if (t === "services" || t === "staff") return mode.offersAppointments;
    return true;
  });
}

/** One palette row. `channel` is set only on the per-channel booking widgets. */
export type PaletteEntry = { type: SectionType; channel?: BookingChannel; label: string; description: string; can: Verdict };

/** The palette rows for a page: the addable types, then — for an org that
    books both channels — "Book appointments" / "Book spaces", each with its
    own verdict (canAddSection) so the row can say why it is disabled. */
export function addableEntries(doc: PageDocument, mode: OrgMode): PaletteEntry[] {
  const rows: PaletteEntry[] = addableTypes(mode).map((type) => ({ type, ...SECTION_META[type], can: canAddSection(doc, type) }));
  if (mode.offersAppointments && mode.offersRentals) {
    for (const channel of ["appointments", "spaces"] as const) {
      rows.push({ type: "booking", channel, ...bookingMeta(channel), can: canAddSection(doc, "booking", channel) });
    }
  }
  return rows;
}
