import { describe, it, expect } from "vitest";
import { sectionAllowed, gatedVisibleSections, BASIC_SECTION_TYPES, addableTypes } from "./gating";
import { DEFAULT_PAGE, newSection, ADDABLE_TYPES } from "./defaults";
import type { PageDocument, SectionOf } from "./schema";
import { PLANS } from "@/lib/billing/plans";

describe("pageSections gating", () => {
  it("basic = header, booking, about, links; all = everything", () => {
    for (const t of [...ADDABLE_TYPES, "booking"] as const) {
      expect(sectionAllowed(t, { pageSections: "all" })).toBe(true);
      expect(sectionAllowed(t, { pageSections: "basic" })).toBe(BASIC_SECTION_TYPES.has(t));
    }
  });
  it("gatedVisibleSections ignores hidden sections", () => {
    const gallery = newSection("gallery");
    const hiddenFaq = { ...(newSection("faq") as SectionOf<"faq">), hidden: true };
    const doc: PageDocument = { ...DEFAULT_PAGE, sections: [DEFAULT_PAGE.sections[0]!, gallery, hiddenFaq, DEFAULT_PAGE.sections[1]!] };
    expect(gatedVisibleSections(doc, { pageSections: "basic" }).map((s) => s.type)).toEqual(["gallery"]);
    expect(gatedVisibleSections(doc, { pageSections: "all" })).toEqual([]);
  });
  it("every plan allows everything in v1", () => {
    for (const plan of Object.values(PLANS)) expect(plan.limits.pageSections).toBe("all");
  });
});

describe("addableTypes (palette by org mode)", () => {
  const APPTS_ONLY = { offersAppointments: true, offersRentals: false };
  const RENTALS_ONLY = { offersAppointments: false, offersRentals: true };
  it("appointments-only never offers Spaces", () => {
    const t = addableTypes(APPTS_ONLY);
    expect(t).not.toContain("spaces");
    expect(t).toContain("services");
    expect(t).toContain("staff");
  });
  it("rentals-only offers Spaces and hides Services and Team", () => {
    const t = addableTypes(RENTALS_ONLY);
    expect(t).toContain("spaces");
    expect(t).not.toContain("services");
    expect(t).not.toContain("staff");
  });
});
