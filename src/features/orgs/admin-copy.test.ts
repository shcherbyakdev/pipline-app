import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/* Provider-facing admin copy never says "rental" or "offering" (admin IA
   spec §1, ruling 3). Vitest runs in Node with no DOM, so this guards the
   SOURCE of each surface: JSX text nodes and the labelled string props.
   Identifiers (`listOfferings`, `rentalOfferingId`) live inside `{…}` or
   before `(`/`.` and are never matched. Extend SURFACES as surfaces migrate. */
// Since i18n Wave 3 the admin's words live in messages, guarded by
// src/i18n/messages.test.ts (rental / offering / skip in both locales), and
// the jsx-no-literals ratchet keeps new literals out. What is left for this
// source scan is the label-prop rule: the ratchet runs with ignoreProps, so a
// re-inlined aria-label="… rental …" is only caught here.
export const SURFACES = [
  "src/features/orgs/components/links-table.tsx",
];

/* The exact literals the audit found. Cheap, unambiguous, and the first thing
   to fail when someone re-inlines a string. */
const FORBIDDEN_LITERALS = [
  "No rentals yet",
  "New rental",
  "Edit rental",
  "← Rentals",
  ">Offering<",
  "Clients see the rental",
  "the offering won",
  "New rental booking",
  "New rental offering",
  "Units booked by the night or day",
  "Services booked as time slots on your calendar",
  "Everyone who can be booked",
  "Shown on rental prices",
  "a rental offering",
  "add an offering and units under",
];

/* JSX text between tags — `>text<` — that contains a forbidden word and no
   code punctuation; and a labelled string prop with one. */
const JSX_TEXT = />\s*[^<>{}();]*\b(rentals?|offerings?)\b[^<>{}();]*</gi;
const LABEL_PROP = /\b(label|title|hint|placeholder|description|aria-label)=["'][^"']*\b(rentals?|offerings?)\b[^"']*["']/gi;

describe("admin copy guard", () => {
  for (const file of SURFACES) {
    it(`${file} never shows "rental" or "offering" to a provider`, () => {
      const src = readFileSync(file, "utf8");
      for (const lit of FORBIDDEN_LITERALS) {
        expect(src, `${file} still contains "${lit}"`).not.toContain(lit);
      }
      const text = src.match(JSX_TEXT) ?? [];
      expect(text, `${file} JSX text: ${text.join(" | ")}`).toEqual([]);
      const props = src.match(LABEL_PROP) ?? [];
      expect(props, `${file} labelled props: ${props.join(" | ")}`).toEqual([]);
    });
  }
});
