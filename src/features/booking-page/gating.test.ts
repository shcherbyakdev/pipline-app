import { describe, it, expect } from "vitest";
import { sectionAllowed, gatedVisibleSections, BASIC_SECTION_TYPES, addableTypes, addableEntries } from "./gating";
import { DEFAULT_PAGE, newSection, newBookingSection, ADDABLE_TYPES } from "./defaults";
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
  const BOTH = { offersAppointments: true, offersRentals: true };
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
  it("both channels: the full palette, in ADDABLE_TYPES order", () => {
    expect(addableTypes(BOTH)).toEqual([...ADDABLE_TYPES]);
  });
});

describe("addableEntries (palette rows)", () => {
  const APPTS_ONLY = { offersAppointments: true, offersRentals: false };
  const BOTH = { offersAppointments: true, offersRentals: true };
  it("one channel: the plain types, no per-channel widgets", () => {
    const rows = addableEntries(DEFAULT_PAGE, APPTS_ONLY);
    expect(rows.map((r) => r.type)).toEqual(addableTypes(APPTS_ONLY));
    expect(rows.every((r) => r.channel === undefined)).toBe(true);
  });
  it("both channels: Book appointments / Book spaces rows after the types, each with its own add verdict", () => {
    const rows = addableEntries(DEFAULT_PAGE, BOTH);
    expect(rows.slice(-2).map((r) => ({ type: r.type, channel: r.channel, label: r.label }))).toEqual([
      { type: "booking", channel: "appointments", label: "Book appointments" },
      { type: "booking", channel: "spaces", label: "Book spaces" },
    ]);
    expect(rows.slice(-2).every((r) => !r.can.ok)).toBe(true);
    const apptsOnlyWidget = { ...DEFAULT_PAGE, sections: [DEFAULT_PAGE.sections[0]!, newBookingSection("appointments", "bookappt")] };
    const rows2 = addableEntries(apptsOnlyWidget, BOTH);
    expect(rows2.find((r) => r.channel === "spaces")?.can.ok).toBe(true);
    expect(rows2.find((r) => r.channel === "appointments")?.can.ok).toBe(false);
  });
});
