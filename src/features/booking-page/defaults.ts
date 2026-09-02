import type { PageDocument, Section, SectionType } from "./schema";

/** What the palette offers. `booking` is seeded and can't be removed;
    `header` is seeded too but may be re-added after deletion. */
export const ADDABLE_TYPES: readonly SectionType[] = [
  "header", "hero", "about", "services", "staff", "spaces", "gallery", "testimonials", "faq", "links", "location",
];

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
export function newSectionId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
}

/** The words a new section starts with — content of the org's document,
    so the studio hands in the `seed` words in the ORG's language (the words a
    client reads), never the admin's. */
export type SectionSeed = { bookNow: string; services: string; team: string; spaces: string };
/** English, for DEFAULT_PAGE (header + booking read none of these) and tests. */
export const EN_SEED: SectionSeed = { bookNow: "Book now", services: "Services", team: "Team", spaces: "Spaces" };

export function newSection(type: SectionType, id: string = newSectionId(), seed: SectionSeed = EN_SEED): Section {
  const base = { id, hidden: false as const };
  switch (type) {
    case "header": return { ...base, type, tagline: "" };
    case "hero": return { ...base, type, headline: "", subheadline: "", align: "left", cta: seed.bookNow };
    case "about": return { ...base, type, title: "", body: "" };
    case "services": return { ...base, type, title: seed.services, style: "list", showPrices: true, showDurations: true };
    case "staff": return { ...base, type, title: seed.team };
    case "spaces": return { ...base, type, title: seed.spaces, style: "cards", showPrices: true, showStay: true, photos: [] };
    case "gallery": return { ...base, type, images: [], columns: 3 };
    case "testimonials": return { ...base, type, items: [{ quote: "", author: "" }] };
    case "faq": return { ...base, type, items: [{ q: "", a: "" }] };
    case "links": return { ...base, type, items: [{ label: "", url: "", icon: "instagram" }] };
    case "location": return { ...base, type, address: "", mapsUrl: "" };
    case "booking": return { ...base, type, title: "" };
  }
}

/** Today's page: header + widget. Stable ids so two fresh orgs produce equal documents. */
export const DEFAULT_PAGE: PageDocument = {
  version: 1,
  layout: "column",
  sections: [newSection("header", "header01"), newSection("booking", "booking1")],
};
