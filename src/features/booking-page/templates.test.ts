import { describe, it, expect } from "vitest";
import { TEMPLATES, applyTemplate, templatePreview, stripSample } from "./templates";
import { pageDocumentSchema } from "./schema";
import { imagePathsIn } from "./images";
import { isSectionEmpty } from "./doc-ops";

describe("templates", () => {
  it("ships six, each a valid preview document and a valid applied document", () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(["classic", "profile", "studio", "split", "team", "minimal"]);
    for (const t of TEMPLATES) {
      expect(pageDocumentSchema.safeParse(templatePreview(t)).success, `${t.id} preview`).toBe(true);
      const applied = applyTemplate(t);
      expect(pageDocumentSchema.safeParse(applied).success, `${t.id} applied`).toBe(true);
      expect(applied.layout).toBe(t.layout);
      expect(applied.sections.map((s) => s.type)).toEqual(t.sections.map((s) => s.type));
    }
  });
  it("applyTemplate strips sample copy and images, assigns fresh ids, keeps live-section titles", () => {
    const ctx = { serviceCount: 1, staffCount: 1, offeringCount: 1 };
    for (const t of TEMPLATES) {
      const applied = applyTemplate(t);
      expect(imagePathsIn(applied)).toEqual([]);
      for (const s of applied.sections) {
        expect(t.sections.some((o) => o.id === s.id), `${t.id} reuses id ${s.id}`).toBe(false);
        if (s.type !== "header" && s.type !== "booking" && s.type !== "services" && s.type !== "staff") {
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
  it("classic is the default page shape, applied", () => {
    expect(applyTemplate(TEMPLATES[0]!).sections.map((s) => s.type)).toEqual(["header", "booking"]);
  });
});
