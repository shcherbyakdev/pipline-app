import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { bookingPath, bookingUrl, hostLabel } from "./url";

describe("booking URLs", () => {
  it("builds root paths, with an optional staff segment", () => {
    expect(bookingPath("anna")).toBe("/anna");
    expect(bookingPath("anna", "maria")).toBe("/anna/maria");
  });
  it("joins the app URL without a double slash", () => {
    expect(bookingUrl("https://booklo.co", "anna")).toBe("https://booklo.co/anna");
    expect(bookingUrl("https://booklo.co/", "anna", "maria")).toBe("https://booklo.co/anna/maria");
  });
  it("hostLabel strips the scheme and trailing slash", () => {
    expect(hostLabel("https://booklo.co/")).toBe("booklo.co");
    expect(hostLabel("http://localhost:3000")).toBe("localhost:3000");
  });
});

// Source guard: nothing outside the legacy redirect folder builds a /book/
// URL by hand — the public page lives at /<handle> now.
describe("no stray /book/ literals", () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  }
  it("src/** (except src/app/book and tests) never quotes a /book/ path", () => {
    const root = join(process.cwd(), "src");
    const offenders = walk(root)
      .filter((p) => /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p))
      .filter((p) => !relative(root, p).startsWith("app/book/"))
      .filter((p) => /(["'`}])\/book\//.test(readFileSync(p, "utf8")))
      .map((p) => relative(process.cwd(), p));
    expect(offenders).toEqual([]);
  });
});
