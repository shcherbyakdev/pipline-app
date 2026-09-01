import { describe, it, expect } from "vitest";
import { BUSINESS_TYPES, applyType, templateOf, typePreview, typesFor, type BusinessType } from "./business-types";
import { TEMPLATES } from "./templates";
import { pageDocumentSchema } from "./schema";
import { pageChannelMode } from "./channel";
import { isSectionEmpty } from "./doc-ops";

describe("business types (spec 2026-08-28 §5.2)", () => {
  it("ships the nine types, each on a template that exists", () => {
    expect(BUSINESS_TYPES.map((t) => t.id)).toEqual([
      "solo", "salon", "clinic", "team", "online", "rooms", "stays", "other-appointments", "other-spaces",
    ]);
    for (const t of BUSINESS_TYPES) expect(TEMPLATES.some((x) => x.id === t.templateId), t.id).toBe(true);
    for (const t of BUSINESS_TYPES) expect(templateOf(t).id).toBe(t.templateId);
  });
  it("typesFor lists one channel and ends in that channel's Something else", () => {
    expect(typesFor("appointments").map((t) => t.id)).toEqual(["solo", "salon", "clinic", "team", "online", "other-appointments"]);
    expect(typesFor("spaces").map((t) => t.id)).toEqual(["rooms", "stays", "other-spaces"]);
    for (const ch of ["appointments", "spaces"] as const) {
      for (const t of typesFor(ch)) expect(t.channel).toBe(ch);
      expect(typesFor(ch).at(-1)!.name).toBe("Something else");
    }
  });
  it("applyType yields a valid document with the type's widget title and cover button, and no sample copy", () => {
    const ctx = { serviceCount: 1, staffCount: 1, offeringCount: 1 };
    for (const t of BUSINESS_TYPES) {
      const mode = pageChannelMode(t.channel);
      const doc = applyType(t, mode);
      expect(pageDocumentSchema.safeParse(doc).success, t.id).toBe(true);
      const booking = doc.sections.find((s) => s.type === "booking");
      expect(booking?.type === "booking" && booking.title, t.id).toBe(t.copy.bookingTitle);
      const hero = doc.sections.find((s) => s.type === "hero");
      if (hero?.type === "hero") {
        expect(t.copy.cta, `${t.id} has a hero but no cta`).toBeDefined();
        expect(hero.cta).toBe(t.copy.cta);
        expect(hero.headline).toBe("");
      }
      for (const s of doc.sections) {
        if (s.type !== "header" && s.type !== "booking" && s.type !== "services" && s.type !== "staff" && s.type !== "spaces") {
          expect(isSectionEmpty(s, ctx), `${t.id}/${s.type} carries sample copy`).toBe(true);
        }
      }
    }
  });
  it("a spaces type never yields a Services or Team section; an appointments type never a Spaces section", () => {
    for (const t of typesFor("spaces")) {
      const types = applyType(t, pageChannelMode("spaces")).sections.map((s) => s.type);
      expect(types).not.toContain("services");
      expect(types).not.toContain("staff");
    }
    for (const t of typesFor("appointments")) {
      expect(applyType(t, pageChannelMode("appointments")).sections.map((s) => s.type)).not.toContain("spaces");
    }
  });
  it("copy fits the document schema: widget title ≤ 60, cover button ≤ 40", () => {
    for (const t of BUSINESS_TYPES) {
      expect(t.copy.bookingTitle.length).toBeLessThanOrEqual(60);
      if (t.copy.cta) expect(t.copy.cta.length).toBeLessThanOrEqual(40);
    }
  });
  it("typePreview keeps the sample copy but reads as the type — rooms and stays are distinct pages", () => {
    const rooms = BUSINESS_TYPES.find((t) => t.id === "rooms")!;
    const stays = BUSINESS_TYPES.find((t) => t.id === "stays")!;
    const mode = pageChannelMode("spaces");
    const title = (t: BusinessType) => typePreview(t, mode).sections.find((s) => s.type === "booking");
    expect(title(rooms)?.type === "booking" && title(rooms)!.title).toBe("Book a space");
    expect(title(stays)?.type === "booking" && title(stays)!.title).toBe("Book a stay");
    // Stays previews its own overnight template, not venue's hourly-rooms page.
    const hero = typePreview(stays, mode).sections.find((s) => s.type === "hero");
    expect(hero?.type === "hero" && hero.headline).toBe("Two cabins outside Kraków");
    expect(templateOf(stays).id).not.toBe(templateOf(rooms).id);
  });
});
