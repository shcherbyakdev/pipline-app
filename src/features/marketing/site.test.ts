import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SITE, FOOTER_LINKS, FEATURES, FEATURES_LABEL, FEATURES_HEADING, FEATURES_SUB, HOW_LABEL, HOW_HEADING, HOW_SUB, HOW_STEPS, CLOSING, CTA, COOKIE_NOTICE, CLAIM, ONBOARDING, WELCOME, FORBIDDEN_COPY, PRICING, allInternalHrefs } from "./site";
import { PLANS } from "@/lib/billing/plans";

// Route hrefs → the app directory that must exist for them (route groups omitted from URL).
const ROUTE_DIRS: Record<string, string> = {
  "/": "src/app/(marketing)",
  "/login": "src/app/(auth)/login",
  "/signup": "src/app/(auth)/signup",
  "/pricing": "src/app/(marketing)/pricing",
  "/waitlist": "src/app/(dashboard)/waitlist",
  "/privacy": "src/app/(marketing)/privacy",
  "/terms": "src/app/(marketing)/terms",
};

/** Everything the landing shows, in one string (lowercased by callers that need it). */
function landingCorpus(): string {
  return [
    SITE.headline, SITE.subheadline, SITE.tagline, SITE.description, SITE.heroNote,
    FEATURES_LABEL, FEATURES_HEADING, FEATURES_SUB, ...FEATURES.flatMap((f) => [f.title, f.body]),
    HOW_LABEL, HOW_HEADING, HOW_SUB, ...HOW_STEPS.flatMap((s) => [s.title, s.body]),
    CLOSING.heading, CLOSING.sub,
    ...FOOTER_LINKS.map((l) => l.label),
    ...Object.values(CTA),
    ...Object.values(CLAIM).map((v) => (typeof v === "function" ? v("x") : v)),
    ...Object.values(COOKIE_NOTICE),
  ].join("\n");
}

describe("site config", () => {
  it("names the product Booklo", () => {
    expect(SITE.name).toBe("Booklo");
  });

  it("lists eight unique features, one line each", () => {
    expect(FEATURES).toHaveLength(8);
    expect(new Set(FEATURES.map((f) => f.title)).size).toBe(8);
    for (const f of FEATURES) expect(f.body.split(/\s+/).length, f.title).toBeLessThanOrEqual(16);
  });

  it("tells how it works in five short steps", () => {
    expect(HOW_STEPS).toHaveLength(5);
    for (const s of HOW_STEPS) expect(s.body.split(/\s+/).length, s.title).toBeLessThanOrEqual(22);
  });

  it("every internal href is an existing route", () => {
    for (const href of allInternalHrefs()) {
      const dir = ROUTE_DIRS[href];
      expect(dir, `no route mapping for ${href}`).toBeDefined();
      expect(existsSync(join(process.cwd(), dir, "page.tsx")), `${dir}/page.tsx missing`).toBe(true);
    }
  });

  it("never advertises unshipped features", () => {
    const corpus = [
      landingCorpus(),
      PRICING.heading, PRICING.sub, PRICING.note, PRICING.founder, PRICING.moreComing,
      ...PRICING.rows.flatMap((r) => [r.label, r.free, r.pro, r.team]),
      ...Object.values(PLANS).map((p) => p.blurb),
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
    ].join("\n").toLowerCase();
    for (const word of FORBIDDEN_COPY) expect(corpus, `copy mentions "${word}"`).not.toContain(word);
  });

  // The landing's copy rule (2026-08-28 redesign): no em- or en-dashes in
  // anything the page shows. Ranges use a hyphen, asides use a comma or a
  // period. Pricing is left out on purpose: it spends the dash as a symbol
  // ("—" is the not-included cell), which the rule was never about.
  it("landing copy contains no em- or en-dashes", () => {
    expect(landingCorpus()).not.toMatch(/[—–]/);
  });

  // /pricing is public whether or not billing is on (2026-09-10), so the
  // footer is the one place it can be found from — and the address beside it
  // is what a payment provider's review looks for.
  it("the footer links pricing and offers an address to write to", () => {
    expect(FOOTER_LINKS.map((l) => l.href)).toContain(SITE.links.pricing);
    expect(SITE.supportEmail).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/);
  });

  // The page is one hero (2026-09-09): a title of two lines at most, a sub
  // of one short paragraph (copy 2026-09-10), the claim bar. Nothing else
  // to fit. Every section heading is one sentence or three short ones.
  it("headline fits two lines and the sub is one short paragraph", () => {
    expect(SITE.headline.split(/\s+/).length).toBeLessThanOrEqual(8);
    expect(SITE.subheadline.split(/\s+/).length).toBeLessThanOrEqual(30);
    for (const h of [HOW_HEADING, FEATURES_HEADING, CLOSING.heading]) expect(h.split(/\s+/).length, h).toBeLessThanOrEqual(9);
    for (const s of [HOW_SUB, FEATURES_SUB, CLOSING.sub]) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(24);
  });

  // Rentals-only orgs (welcome-banner.tsx) must not fall back to the
  // appointments CTA/subtitle — their copy has to actually differ, not just
  // exist, or the banner's mode branch could collapse to one string and the
  // dead-end would come right back.
  it("WELCOME has rentals-specific copy distinct from the appointments copy", () => {
    expect(WELCOME.subRentals).not.toBe(WELCOME.sub);
    expect(WELCOME.subRentals.length).toBeGreaterThan(0);
  });

  it("the onboarding picker lists Spaces first (H5b ruling 1)", () => {
    expect(ONBOARDING.modes.map((m) => m.value)).toEqual(["rentals", "appointments"]);
  });

  it("FORBIDDEN_COPY keeps the provider name and the retired channel words, drops 'payment' now that collection shipped (S9), and holds the calendar sync until S11", () => {
    expect(FORBIDDEN_COPY).toEqual(["stripe", "offering", "rentals", "google", "calendar sync"]);
  });

  it("the resources pricing row reads its numbers from PLANS", () => {
    const row = PRICING.rows[0];
    expect(row.label).toBe("Bookable resources — people and units");
    expect([row.free, row.pro, row.team]).toEqual(
      (["free", "pro", "team"] as const).map((id) => String(PLANS[id].limits.bookableResources)),
    );
  });

  it("pricing speaks of people and rooms, never seats", () => {
    expect(PRICING.sub).toBe(
      "Free for you and one more person, or two rooms. Pay when you need your brand, reminders for every booking or more bookable resources.",
    );
  });
});
