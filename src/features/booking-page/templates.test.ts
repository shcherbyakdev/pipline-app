import { describe, it, expect } from "vitest";
import { TEMPLATES, applyTemplate, templatePreview, stripSample, fitToMode } from "./templates";
import { pageDocumentSchema } from "./schema";
import { imagePathsIn } from "./images";
import { isSectionEmpty } from "./doc-ops";
import { newSection } from "./defaults";

const APPTS_ONLY = { offersAppointments: true, offersRentals: false };
const RENTALS_ONLY = { offersAppointments: false, offersRentals: true };
const BOTH = { offersAppointments: true, offersRentals: true };

describe("templates", () => {
  it("ships seven, each a valid preview and applied document in every mode", () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(["classic", "profile", "studio", "venue", "split", "team", "minimal"]);
    for (const t of TEMPLATES) for (const mode of [APPTS_ONLY, RENTALS_ONLY, BOTH]) {
      expect(pageDocumentSchema.safeParse(templatePreview(t, mode)).success, `${t.id} preview`).toBe(true);
      const applied = applyTemplate(t, mode);
      expect(pageDocumentSchema.safeParse(applied).success, `${t.id} applied`).toBe(true);
      expect(applied.layout).toBe(t.layout);
    }
    // appointments-only leaves the legacy six exactly as authored
    for (const t of TEMPLATES.filter((x) => x.id !== "venue")) {
      expect(applyTemplate(t, APPTS_ONLY).sections.map((s) => s.type)).toEqual(t.sections.map((s) => s.type));
    }
  });
  it("applyTemplate strips sample copy and images, assigns fresh ids, keeps live-section titles", () => {
    const ctx = { serviceCount: 1, staffCount: 1, offeringCount: 1 };
    for (const t of TEMPLATES) {
      const applied = applyTemplate(t, BOTH);
      expect(imagePathsIn(applied)).toEqual([]);
      for (const s of applied.sections) {
        expect(t.sections.some((o) => o.id === s.id), `${t.id} reuses id ${s.id}`).toBe(false);
        if (s.type !== "header" && s.type !== "booking" && s.type !== "services" && s.type !== "staff" && s.type !== "spaces") {
          expect(isSectionEmpty(s, ctx), `${t.id}/${s.type} not stripped`).toBe(true);
        }
        if (s.type === "services") expect(s.title).toBe("Services");
      }
    }
  });
  it("stripSample keeps list shapes (an empty row per sample item) and link icons", () => {
    const studio = TEMPLATES.find((t) => t.id === "studio")!;
    const quotes = studio.sections.find((s) => s.type === "testimonials")!;
    const stripped = stripSample(quotes);
    expect(stripped.type === "testimonials" && stripped.items.every((i) => i.quote === "" && i.author === "")).toBe(true);
    const profile = TEMPLATES.find((t) => t.id === "profile")!;
    const links = profile.sections.find((s) => s.type === "links")!;
    const strippedLinks = stripSample(links);
    expect(strippedLinks.type === "links" && strippedLinks.items.map((i) => i.icon)).toEqual(links.type === "links" ? links.items.map((i) => i.icon) : []);
  });
  it("the widget follows the catalogue: booking sits right after services/spaces, ahead of gallery, quotes, FAQ and address", () => {
    const order = (id: string) => TEMPLATES.find((t) => t.id === id)!.sections.map((s) => s.type);
    expect(order("studio")).toEqual(["hero", "services", "booking", "gallery", "testimonials", "location"]);
    expect(order("venue")).toEqual(["hero", "spaces", "booking", "gallery", "location", "faq"]);
    expect(order("profile")).toEqual(["header", "about", "services", "booking", "links"]);
    // Split docks the widget at desktop; below that it is in DOM order, so it
    // must not trail the FAQ and address on a phone.
    expect(order("split")).toEqual(["hero", "about", "services", "booking", "faq", "location"]);
    expect(order("team")).toEqual(["header", "staff", "services", "booking", "location"]);
    expect(order("minimal")).toEqual(["hero", "booking", "links"]);
  });
  it("every cover carries a Book button label, and applying keeps it — a label, not sample copy", () => {
    for (const t of TEMPLATES) {
      const hero = t.sections.find((s) => s.type === "hero");
      if (!hero) continue;
      expect(hero.type === "hero" && hero.cta?.trim(), `${t.id} cover has no button`).toBeTruthy();
      const applied = applyTemplate(t, BOTH).sections.find((s) => s.type === "hero");
      expect(applied?.type === "hero" && applied.cta).toBe(hero.type === "hero" ? hero.cta : undefined);
    }
    const venue = TEMPLATES.find((t) => t.id === "venue")!.sections.find((s) => s.type === "hero");
    expect(venue?.type === "hero" && venue.cta).toBe("Book a space");
  });
  it("classic is the default page shape, applied", () => {
    expect(applyTemplate(TEMPLATES[0]!, BOTH).sections.map((s) => s.type)).toEqual(["header", "booking"]);
  });
  it("stripSample on a spaces section only changes the id — a live section, not sample copy", () => {
    const sp = newSection("spaces");
    expect(stripSample(sp)).toEqual({ ...sp, id: expect.stringMatching(/^[a-z0-9]{6,12}$/) });
  });
});

describe("fitToMode", () => {
  const studio = TEMPLATES.find((t) => t.id === "studio")!;
  const team = TEMPLATES.find((t) => t.id === "team")!;
  const venue = TEMPLATES.find((t) => t.id === "venue")!;
  const types = (s: { type: string }[]) => s.map((x) => x.type);
  const stable = (s: { id: string }) => ("sp" + s.id).slice(0, 12);

  it("rentals-only: services becomes spaces (style kept), staff is dropped", () => {
    const out = fitToMode(studio.sections, RENTALS_ONLY, stable);
    expect(types(out)).toEqual(["hero", "spaces", "booking", "gallery", "testimonials", "location"]);
    const spaces = out.find((s) => s.type === "spaces");
    expect(spaces?.type === "spaces" && spaces.style).toBe("cards");
    expect(spaces?.type === "spaces" && spaces.title).toBe("Spaces");
    expect(types(fitToMode(team.sections, RENTALS_ONLY, stable))).toEqual(["header", "spaces", "booking", "location"]);
  });
  it("both: spaces is inserted right after services", () => {
    expect(types(fitToMode(studio.sections, BOTH, stable))).toEqual(["hero", "services", "spaces", "booking", "gallery", "testimonials", "location"]);
  });
  it("both: a template that already authored spaces never gets a second one inserted", () => {
    const sections = [newSection("services"), newSection("spaces"), newSection("booking")];
    expect(types(fitToMode(sections, BOTH, stable))).toEqual(["services", "spaces", "booking"]);
  });
  it("appointments-only: spaces sections are dropped", () => {
    expect(types(fitToMode(venue.sections, APPTS_ONLY, stable))).not.toContain("spaces");
  });
  it("derived ids are stable per source and schema-shaped", () => {
    const a = fitToMode(studio.sections, BOTH, stable);
    const b = fitToMode(studio.sections, BOTH, stable);
    expect(a.map((s) => s.id)).toEqual(b.map((s) => s.id));
    for (const s of a) expect(s.id).toMatch(/^[a-z0-9]{6,12}$/);
    expect(new Set(a.map((s) => s.id)).size).toBe(a.length);
  });
  it("applyTemplate assigns fresh ids even to the sections fitToMode created", () => {
    const applied = applyTemplate(studio, BOTH);
    for (const s of applied.sections) expect(studio.sections.some((o) => o.id === s.id || stable(o) === s.id)).toBe(false);
  });
});
