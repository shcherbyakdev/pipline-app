// The pageSections entitlement rule — pure, so the palette (client), the
// publish action (server) and the tests share one answer.
import type { PlanLimits } from "@/lib/billing/plans";
import type { OrgMode } from "@/features/orgs/mode";
import type { PageDocument, Section, SectionType } from "./schema";
import { ADDABLE_TYPES } from "./defaults";

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
