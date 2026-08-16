import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  SITE,
  NAV_LINKS,
  STEPS,
  FEATURES,
  FAQ,
  FOOTER_COLUMNS,
  FORBIDDEN_COPY,
  allInternalHrefs,
} from "./site";

// Route hrefs → the app directory that must exist for them (route groups omitted from URL).
const ROUTE_DIRS: Record<string, string> = {
  "/": "src/app/(marketing)",
  "/login": "src/app/(auth)/login",
  "/signup": "src/app/(auth)/signup",
};

describe("site config", () => {
  it("names the product Booklo", () => {
    expect(SITE.name).toBe("Booklo");
  });

  it("every internal href is an in-page anchor or an existing route", () => {
    for (const href of allInternalHrefs()) {
      if (href.startsWith("#")) continue;
      const dir = ROUTE_DIRS[href];
      expect(dir, `no route mapping for ${href}`).toBeDefined();
      expect(existsSync(join(process.cwd(), dir, "page.tsx")), `${dir}/page.tsx missing`).toBe(true);
    }
  });

  it("anchors used in nav exist as section ids", () => {
    const anchors = Object.values(SITE.anchors);
    for (const l of NAV_LINKS) expect(anchors).toContain(l.href);
  });

  it("has three numbered steps, six unique features, ≥5 FAQ items", () => {
    expect(STEPS.map((s) => s.number)).toEqual(["01", "02", "03"]);
    expect(FEATURES).toHaveLength(6);
    expect(new Set(FEATURES.map((f) => f.title)).size).toBe(6);
    expect(FAQ.length).toBeGreaterThanOrEqual(5);
    expect(new Set(FAQ.map((f) => f.question)).size).toBe(FAQ.length);
  });

  it("never advertises unshipped features", () => {
    const corpus = [
      SITE.headline, SITE.subheadline, SITE.tagline, SITE.description, SITE.heroNote,
      ...STEPS.flatMap((s) => [s.title, s.body]),
      ...FEATURES.flatMap((f) => [f.title, f.body]),
      ...FAQ.flatMap((f) => [f.question, f.answer]),
    ].join("\n").toLowerCase();
    for (const word of FORBIDDEN_COPY) expect(corpus, `copy mentions "${word}"`).not.toContain(word);
  });

  it("headline is short and outcome-led (≤ 8 words)", () => {
    expect(SITE.headline.split(/\s+/).length).toBeLessThanOrEqual(8);
  });
});
