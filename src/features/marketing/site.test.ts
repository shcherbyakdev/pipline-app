import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SITE,
  NAV_LINKS,
  STEPS,
  FEATURES,
  FAQ,
  SECTIONS,
  CTA,
  CLAIM,
  ONBOARDING,
  WELCOME,
  FINAL_CTA,
  ANNOUNCEMENT,
  AUDIENCE,
  HERO_TABS,
  FORBIDDEN_COPY,
  PRICING,
  anchorId,
  allInternalHrefs,
} from "./site";
import { PLANS } from "@/lib/billing/plans";

// Route hrefs → the app directory that must exist for them (route groups omitted from URL).
const ROUTE_DIRS: Record<string, string> = {
  "/": "src/app/(marketing)",
  "/login": "src/app/(auth)/login",
  "/signup": "src/app/(auth)/signup",
  "/pricing": "src/app/(marketing)/pricing",
  "/privacy": "src/app/(marketing)/privacy",
  "/terms": "src/app/(marketing)/terms",
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

  it("every anchor yields a usable id and every nav href is an anchor or an internal route", () => {
    const anchors: string[] = Object.values(SITE.anchors);
    for (const a of anchors) expect(anchorId(a), `bad anchor ${a}`).not.toBe("");
    for (const l of NAV_LINKS) {
      expect(anchors.includes(l.href) || l.href in ROUTE_DIRS, `nav href ${l.href} is neither anchor nor route`).toBe(true);
    }
  });

  it("rejects an anchor without a leading #", () => {
    expect(() => anchorId("features")).toThrow();
  });

  // Source-level guard: the sections must take their id from SITE.anchors, not a hardcoded string,
  // so renaming an anchor can never silently break the nav links that point at it.
  it("each section derives its id from SITE.anchors", () => {
    const files: Record<string, keyof typeof SITE.anchors> = {
      "how-it-works.tsx": "how",
      "features.tsx": "features",
      "faq.tsx": "faq",
    };
    for (const [file, key] of Object.entries(files)) {
      const src = readFileSync(join(process.cwd(), "src/features/marketing/components", file), "utf8");
      expect(src, `${file} should use anchorId(SITE.anchors.${key})`).toContain(`anchorId(SITE.anchors.${key})`);
    }
  });

  it("has three numbered steps, seven unique features, ≥5 FAQ items", () => {
    expect(STEPS.map((s) => s.number)).toEqual(["01", "02", "03"]);
    expect(FEATURES).toHaveLength(7);
    expect(new Set(FEATURES.map((f) => f.title)).size).toBe(7);
    expect(FAQ.length).toBeGreaterThanOrEqual(5);
    expect(new Set(FAQ.map((f) => f.question)).size).toBe(FAQ.length);
  });

  it("never advertises unshipped features", () => {
    const corpus = [
      ...SITE.headline, SITE.subheadline, SITE.tagline, SITE.description, SITE.heroNote,
      ...STEPS.flatMap((s) => [s.title, s.body]),
      ...FEATURES.flatMap((f) => [f.title, f.body]),
      ...FAQ.flatMap((f) => [f.question, f.answer]),
      ...Object.values(SECTIONS).flatMap((s) => [
        s.heading,
        s.eyebrow,
        "sub" in s ? s.sub : "",
      ]),
      ...Object.values(CTA),
      PRICING.heading, PRICING.sub, PRICING.note, PRICING.founder, PRICING.moreComing,
      ...PRICING.rows.flatMap((r) => [r.label, r.free, r.pro, r.team]),
      ...Object.values(PLANS).map((p) => p.blurb),
      ...Object.values(CLAIM).map((v) => (typeof v === "function" ? v("x") : v)),
      // ONBOARDING.modes is an array of {value, title, blurb} cards, not a
      // string or a function — flatten it to its titles/blurbs so the
      // picker copy is actually scanned, not silently stringified to
      // "[object Object]" by the corpus join below.
      ...Object.values(ONBOARDING).flatMap((v) => {
        if (typeof v === "function") return v("x");
        if (Array.isArray(v)) return v.flatMap((m) => [m.title, m.blurb]);
        return v;
      }),
      ...Object.values(WELCOME).map((v) => (typeof v === "function" ? v("x") : v)),
      FINAL_CTA.heading, FINAL_CTA.sub,
      ...Object.values(ANNOUNCEMENT),
      AUDIENCE.heading, AUDIENCE.sub, ...AUDIENCE.blocks.flatMap((b) => [b.title, b.body, ...b.groups]),
      ...SITE.truths,
      ...HERO_TABS.map((t) => t.label),
    ].join("\n").toLowerCase();
    for (const word of FORBIDDEN_COPY) expect(corpus, `copy mentions "${word}"`).not.toContain(word);
  });

  // The landing's copy rule (2026-08-28 redesign): no em- or en-dashes in
  // anything the page shows. Ranges use a hyphen, asides use a comma or a
  // period. Pricing is left out on purpose: its table cells and one row
  // label still carry the dash and the page is off while billing is.
  it("landing copy contains no em- or en-dashes", () => {
    const landing = [
      ...SITE.headline, SITE.subheadline, SITE.tagline, SITE.description, SITE.heroNote,
      ...SITE.truths,
      ...STEPS.flatMap((s) => [s.word, s.title, s.body]),
      ...FEATURES.flatMap((f) => [f.title, f.body]),
      ...FAQ.flatMap((f) => [f.question, f.answer]),
      ...Object.values(SECTIONS).flatMap((s) => [s.heading, s.eyebrow, "sub" in s ? s.sub : ""]),
      ...Object.values(CTA),
      ...Object.values(CLAIM).map((v) => (typeof v === "function" ? v("x") : v)),
      FINAL_CTA.heading, FINAL_CTA.sub,
      ...Object.values(ANNOUNCEMENT),
      AUDIENCE.heading, AUDIENCE.sub, ...AUDIENCE.blocks.flatMap((b) => [b.title, b.body, ...b.groups]),
    ].join("\n");
    expect(landing).not.toMatch(/[—–]/);
  });

  it("the marked headline word is in the second headline line", () => {
    expect(SITE.headline[1]).toContain(SITE.markedWord);
  });

  it("headline is two short lines (≤ 4 words each)", () => {
    expect(SITE.headline).toHaveLength(2);
    for (const line of SITE.headline) expect(line.split(/\s+/).length).toBeLessThanOrEqual(4);
  });

  // Rentals-only orgs (welcome-banner.tsx) must not fall back to the
  // appointments CTA/subtitle — their copy has to actually differ, not just
  // exist, or the banner's mode branch could collapse to one string and the
  // dead-end would come right back.
  it("WELCOME has rentals-specific copy distinct from the appointments copy", () => {
    expect(WELCOME.subRentals).not.toBe(WELCOME.sub);
    expect(WELCOME.subBoth).not.toBe(WELCOME.sub);
    expect(WELCOME.subBoth).not.toBe(WELCOME.subRentals);
    expect(WELCOME.subRentals.length).toBeGreaterThan(0);
    expect(WELCOME.subBoth.length).toBeGreaterThan(0);
  });

  it("the onboarding picker lists Spaces first (H5b ruling 1)", () => {
    expect(ONBOARDING.modes.map((m) => m.value)).toEqual(["rentals", "appointments", "both"]);
  });

  it("FORBIDDEN_COPY retires the old channel words and keeps the H4 ones (H5b ruling 7)", () => {
    expect(FORBIDDEN_COPY).toEqual(["google", "calendar sync", "stripe", "payment", "offering", "rentals"]);
  });

  it("the resources pricing row reads its numbers from PLANS", () => {
    const row = PRICING.rows[0];
    expect(row.label).toBe("Bookable resources — people and units");
    expect([row.free, row.pro, row.team]).toEqual(
      (["free", "pro", "team"] as const).map((id) => String(PLANS[id].limits.bookableResources)),
    );
  });

  it("pricing and the cost FAQ speak of one person or one room, never seats", () => {
    expect(PRICING.sub).toBe(
      "Free for one person or one room. Pay when you need your brand, unlimited services or more bookable resources.",
    );
    const cost = FAQ.find((f) => f.question === "What does it cost?")!;
    expect(cost.answer.toLowerCase()).not.toMatch(/seat|team member/);
  });
});
