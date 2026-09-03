import { describe, it, expect, vi } from "vitest";
import { metaDescription, pageDescription, heroImagePath, pageMetadata } from "./metadata";
import { DEFAULT_PAGE, newSection } from "./defaults";
import type { Section } from "./schema";

const header = DEFAULT_PAGE.sections[0]!;
const booking = DEFAULT_PAGE.sections[1]!;
const IMG = "123e4567-e89b-12d3-a456-426614174000/page/abcdef0123456789.png";

vi.mock("next-intl/server", async () => {
  const { translatorFor } = await import("@/i18n/test-translator");
  return {
    getTranslations: async (opts: { locale: "en" | "uk"; namespace: never }) => translatorFor(opts.locale, opts.namespace),
  };
});

describe("metaDescription (spec 2026-08-28 §3.6, per locale)", () => {
  it("names the page's own channel in the page's language", async () => {
    expect(await metaDescription("en", "appointments", "Anna's")).toBe("Book an appointment with Anna's.");
    expect(await metaDescription("en", "spaces", "Anna's")).toBe("Book a space at Anna's.");
    expect(await metaDescription("uk", "appointments", "Анна")).toBe("Запишіться до Анна.");
    expect(await metaDescription("uk", "spaces", "Лофт 3")).toBe("Забронюйте простір у Лофт 3.");
  });
});

describe("pageDescription", () => {
  it("prefers hero headline, then header tagline, then about's first line, then the fallback", () => {
    const hero = { ...newSection("hero"), headline: "Hair by Anna", imagePath: IMG };
    const tagline = { ...header, tagline: "Colour specialist" };
    const about = { ...newSection("about"), body: "I cut hair.\n\nSince 2010." };
    expect(pageDescription({ ...DEFAULT_PAGE, sections: [tagline, hero, about, booking] }, "fb")).toBe("Hair by Anna");
    expect(pageDescription({ ...DEFAULT_PAGE, sections: [tagline, about, booking] }, "fb")).toBe("Colour specialist");
    expect(pageDescription({ ...DEFAULT_PAGE, sections: [header, about, booking] }, "fb")).toBe("I cut hair.");
    expect(pageDescription(DEFAULT_PAGE, "fb")).toBe("fb");
  });
  it("skips hidden sections", () => {
    const hero = { ...(newSection("hero") as Extract<Section, { type: "hero" }>), headline: "Hidden", hidden: true };
    expect(pageDescription({ ...DEFAULT_PAGE, sections: [header, hero, booking] }, "fb")).toBe("fb");
  });
});

describe("pageMetadata", () => {
  const APPTS = { orgName: "Anna's", offersAppointments: true, offersRentals: false };
  it("sets title, description and an OG image only when the hero has one", () => {
    const hero = { ...newSection("hero"), headline: "Hair by Anna", imagePath: IMG };
    const meta = pageMetadata({ ...DEFAULT_PAGE, sections: [header, hero, booking] }, APPTS, "http://127.0.0.1:54351", "Book an appointment with Anna's.");
    expect(meta.title).toBe("Anna's");
    expect(meta.description).toBe("Hair by Anna");
    expect(meta.openGraph?.images).toEqual([`http://127.0.0.1:54351/storage/v1/object/public/branding/${IMG}`]);
    const plain = pageMetadata(DEFAULT_PAGE, APPTS, "http://x", "Book an appointment with Anna's.");
    expect(plain.description).toBe("Book an appointment with Anna's.");
    expect(plain.openGraph).toBeUndefined();
    expect(heroImagePath(DEFAULT_PAGE)).toBeNull();
  });
  it("the fallback description is the PAGE's channel, not the org's declared mix (spec 2026-08-28 §3.6)", () => {
    const BOTH = { orgName: "Anna's", offersAppointments: true, offersRentals: true };
    expect(pageMetadata(DEFAULT_PAGE, BOTH, "http://127.0.0.1:54351", "Book an appointment with Anna's.").description).toBe("Book an appointment with Anna's.");
    expect(pageMetadata(DEFAULT_PAGE, BOTH, "http://127.0.0.1:54351", "Book a space at Anna's.").description).toBe("Book a space at Anna's.");
  });
});
