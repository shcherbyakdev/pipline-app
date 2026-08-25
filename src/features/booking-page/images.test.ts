import { describe, it, expect } from "vitest";
import {
  PAGE_IMAGE_PATH_RE, PAGE_IMAGE_MAX_BYTES, PAGE_IMAGE_MAX_OBJECTS, pageImagePathFor, pageImagePrefix, pageImageUrl,
  imagePathsIn, orphanPaths, isAllowedPageImageType,
} from "./images";

const ORG = "123e4567-e89b-12d3-a456-426614174000";
const SHA = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

describe("pageImagePathFor", () => {
  it("builds {orgId}/page/{sha:16}.{ext} for the three raster types", () => {
    expect(pageImagePathFor(ORG, SHA, "image/png")).toBe(`${ORG}/page/abcdef0123456789.png`);
    expect(pageImagePathFor(ORG, SHA, "image/jpeg")).toBe(`${ORG}/page/abcdef0123456789.jpg`);
    expect(pageImagePathFor(ORG, SHA, "image/webp")).toBe(`${ORG}/page/abcdef0123456789.webp`);
  });
  it("refuses anything else (SVG included)", () => {
    expect(pageImagePathFor(ORG, SHA, "image/svg+xml")).toBeNull();
    expect(isAllowedPageImageType("image/svg+xml")).toBe(false);
    expect(isAllowedPageImageType("image/webp")).toBe(true);
  });
  it("every built path matches PAGE_IMAGE_PATH_RE and the org prefix", () => {
    const p = pageImagePathFor(ORG, SHA, "image/png")!;
    expect(PAGE_IMAGE_PATH_RE.test(p)).toBe(true);
    expect(p.startsWith(pageImagePrefix(ORG))).toBe(true);
  });
  it("rejects traversal, logo paths and foreign shapes", () => {
    for (const bad of [`${ORG}/logo-${SHA}.png`, `../${ORG}/page/abcdef0123456789.png`, `${ORG}/page/x.png`, `${ORG}/page/abcdef0123456789.svg`]) {
      expect(PAGE_IMAGE_PATH_RE.test(bad), bad).toBe(false);
    }
  });
});

describe("pageImageUrl", () => {
  it("mirrors storage.getPublicUrl for the branding bucket", () => {
    expect(pageImageUrl("http://127.0.0.1:54351", `${ORG}/page/abcdef0123456789.png`)).toBe(
      `http://127.0.0.1:54351/storage/v1/object/public/branding/${ORG}/page/abcdef0123456789.png`,
    );
    expect(pageImageUrl("https://x.supabase.co/", "a/page/b.png")).toBe("https://x.supabase.co/storage/v1/object/public/branding/a/page/b.png");
  });
});

describe("imagePathsIn / orphanPaths", () => {
  const doc = {
    sections: [
      { id: "hero0001", type: "hero" as const, hidden: false, headline: "", subheadline: "", align: "left" as const, imagePath: "o/page/a.png" },
      { id: "about001", type: "about" as const, hidden: false, title: "", body: "", photoPath: "o/page/b.png" },
      { id: "gal00001", type: "gallery" as const, hidden: false, columns: 3 as const, images: [{ path: "o/page/c.png", alt: "" }, { path: "o/page/a.png", alt: "" }] },
      { id: "booking1", type: "booking" as const, hidden: false as const, title: "" },
    ],
  };
  it("collects hero, about and gallery paths in order (duplicates kept)", () => {
    expect(imagePathsIn(doc)).toEqual(["o/page/a.png", "o/page/b.png", "o/page/c.png", "o/page/a.png"]);
  });
  it("orphanPaths = listed minus referenced", () => {
    expect(orphanPaths(["o/page/a.png", "o/page/z.png", "o/page/c.png"], imagePathsIn(doc))).toEqual(["o/page/z.png"]);
    expect(orphanPaths([], ["o/page/a.png"])).toEqual([]);
  });
  it("collects spaces photos too", () => {
    const withSpaces = {
      sections: [
        ...doc.sections,
        { id: "spaces01", type: "spaces" as const, hidden: false, title: "Spaces", style: "cards" as const, showPrices: true, showStay: true,
          photos: [{ offeringId: "11111111-2222-4333-8444-555555555555", path: "o/page/d.png" }] },
      ],
    };
    expect(imagePathsIn(withSpaces)).toEqual(["o/page/a.png", "o/page/b.png", "o/page/c.png", "o/page/a.png", "o/page/d.png"]);
  });
});

describe("limits", () => {
  it("caps a single image under Vercel's 4.5 MB function body (server-action relay)", () => {
    expect(PAGE_IMAGE_MAX_BYTES).toBe(4 * 1024 * 1024);
    expect(PAGE_IMAGE_MAX_BYTES).toBeLessThan(4.5 * 1000 * 1000);
  });
  it("caps objects per org", () => {
    expect(PAGE_IMAGE_MAX_OBJECTS).toBe(200);
  });
});
