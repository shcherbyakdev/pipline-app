import { describe, it, expect } from "vitest";
import IntlMessageFormat from "intl-messageformat";
import en from "../../messages/en.json";
import uk from "../../messages/uk.json";
import { LOCALES, type Locale } from "./config";
import { deepMerge } from "./messages";

// The glossary's per-language forbidden list (messages/GLOSSARY.md, spec
// §6): the product never says "rental" or "offering" to a person, and
// never offers to "skip". (The landing page's own FORBIDDEN_COPY — no
// "payment", "stripe", "google" claims — is a marketing rule and applies to
// the `marketing` namespace when Wave 5 adds it.)
const FORBIDDEN: Record<Locale, readonly string[]> = {
  en: ["rental", "offering", "skip"],
  uk: ["оренда", "офер", "пропустити"],
};

/* The guards from spec 2026-09-02 §6. Every locale must carry every key,
   compile as ICU, name the same placeholders and tags as English, cover
   every plural category its language has, and actually be translated. */

const MESSAGES: Record<Locale, unknown> = { en, uk };

// Values that are the same in every language on purpose: codes, brand,
// examples. Anything else equal to English is an untranslated string.
const SAME_IN_EVERY_LOCALE = new Set([
  "auth.emailPlaceholder",
  // Brand names of the link platforms; a pure-placeholder pattern.
  "public.links.instagram",
  "public.links.facebook",
  "public.links.tiktok",
  "public.links.whatsapp",
  "public.units.summary",
  "studio.forms.links.icon.instagram",
  "studio.forms.links.icon.facebook",
  "studio.forms.links.icon.tiktok",
  "studio.forms.links.icon.whatsapp",
  // A plan name.
  "studio.proBadge",
]);

// The studio never offers to "skip" or do something "later" (widget
// templates spec 2026-09-02 §5, ruling 2) — the former copy.test.ts guard.
const STUDIO_FORBIDDEN: Record<Locale, readonly string[]> = {
  en: ["skip", "later"],
  uk: ["пропустити", "пізніше"],
};

function flatten(value: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (typeof value === "string") out[prefix] = value;
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

const placeholders = (msg: string) => [...msg.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort();
const tags = (msg: string) => [...msg.matchAll(/<(\w+)>/g)].map((m) => m[1]).sort();

// formatjs AST: 6 = plural, 5 = select (both carry `options`), 8 = tag (`children`).
type Node = { type: number; pluralType?: string; options?: Record<string, { value: Node[] }>; children?: Node[] };
function cardinalPlurals(nodes: Node[], out: Node[] = []): Node[] {
  for (const n of nodes) {
    if (n.type === 6 && n.pluralType !== "ordinal") out.push(n);
    for (const opt of Object.values(n.options ?? {})) cardinalPlurals(opt.value, out);
    if (n.children) cardinalPlurals(n.children, out);
  }
  return out;
}

describe("messages", () => {
  const flatEn = flatten(en);

  for (const locale of LOCALES) {
    const flat = flatten(MESSAGES[locale]);

    it(`${locale}: has exactly en's keys and no empty values`, () => {
      expect(Object.keys(flat).sort()).toEqual(Object.keys(flatEn).sort());
      for (const [k, v] of Object.entries(flat)) expect(v.trim(), k).not.toBe("");
    });

    it(`${locale}: every message compiles and names en's placeholders and tags`, () => {
      for (const [k, v] of Object.entries(flat)) {
        expect(() => new IntlMessageFormat(v, locale), k).not.toThrow();
        expect(placeholders(v), k).toEqual(placeholders(flatEn[k] ?? ""));
        expect(tags(v), k).toEqual(tags(flatEn[k] ?? ""));
      }
    });

    it(`${locale}: every plural covers the categories the language needs`, () => {
      const needed = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
      for (const [k, v] of Object.entries(flat)) {
        for (const p of cardinalPlurals(new IntlMessageFormat(v, locale).getAst() as Node[])) {
          for (const cat of needed) expect(Object.keys(p.options ?? {}), `${k} lacks "${cat}"`).toContain(cat);
        }
      }
    });

    it(`${locale}: no message contains a forbidden word`, () => {
      for (const [k, v] of Object.entries(flat)) {
        const lower = v.toLowerCase();
        for (const word of FORBIDDEN[locale]) {
          expect(lower.includes(word), `${k} contains forbidden word "${word}"`).toBe(false);
        }
      }
    });

    it(`${locale}: the studio never offers a skip or a later`, () => {
      for (const [k, v] of Object.entries(flat)) {
        if (!k.startsWith("studio.")) continue;
        for (const word of STUDIO_FORBIDDEN[locale]) expect(v.toLowerCase().includes(word), `${k} says "${word}"`).toBe(false);
      }
    });

    // The layout cards are a name and a one-line description each; a dash
    // would read as a second clause (the former widget-theme.test.ts rule).
    it(`${locale}: no widget layout card carries a dash`, () => {
      for (const [k, v] of Object.entries(flat)) {
        if (k.startsWith("studio.layouts.") || k.startsWith("studio.stayLayouts.")) expect(v, k).not.toMatch(/[—–]/);
      }
    });

    if (locale !== "en") {
      it(`${locale}: nothing is left in English`, () => {
        for (const [k, v] of Object.entries(flat)) {
          if (!SAME_IN_EVERY_LOCALE.has(k)) expect(v, k).not.toBe(flatEn[k]);
        }
      });
    }
  }

  // Six components split these on a space into seven column headings; a
  // translator's stray space or a two-word day would leave a hole silently.
  it("every weekday list has exactly seven single tokens in every locale", () => {
    for (const locale of LOCALES) {
      const flat = flatten(MESSAGES[locale]);
      for (const k of ["availability.weekdaysShort", "availability.weekdaysLong", "bookings.weekdays", "public.slots.weekdays"]) {
        expect(flat[k]?.split(" "), `${locale} ${k}`).toHaveLength(7);
      }
    }
  });

  it("deepMerge keeps English underneath a partial locale (spec D8)", () => {
    expect(deepMerge({ a: { x: "en-x", y: "en-y" }, b: "en-b" }, { a: { x: "uk-x" } })).toEqual({
      a: { x: "uk-x", y: "en-y" },
      b: "en-b",
    });
  });
});
