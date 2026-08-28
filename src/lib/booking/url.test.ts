import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { bookingLink, bookingPath, bookingUrl, channelPath, channelUrl, embedSrc, hostLabel, targetQuery } from "./url";

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
  it("targetQuery renders the three query targets, nothing for staff/none", () => {
    expect(targetQuery({ service: "s1" })).toBe("?service=s1");
    expect(targetQuery({ space: "o1" })).toBe("?space=o1");
    expect(targetQuery({ channel: "spaces" })).toBe("?channel=spaces");
    expect(targetQuery({ staff: "anna" })).toBe("");
    expect(targetQuery(null)).toBe("");
    expect(targetQuery()).toBe("");
  });
  it("bookingLink: a staff target is a path segment, everything else a query on the page", () => {
    expect(bookingLink("https://booklo.co", "anna")).toBe("https://booklo.co/anna");
    expect(bookingLink("https://booklo.co/", "anna", { staff: "maria" })).toBe("https://booklo.co/anna/maria");
    expect(bookingLink("https://booklo.co", "anna", { service: "s1" })).toBe("https://booklo.co/anna?service=s1");
    expect(bookingLink("https://booklo.co", "anna", { space: "o1" })).toBe("https://booklo.co/anna?space=o1");
  });
  it("channelPath / channelUrl: appointments is the root, spaces is a segment", () => {
    expect(channelPath("anna", "appointments")).toBe("/anna");
    expect(channelPath("anna", "spaces")).toBe("/anna/spaces");
    expect(channelUrl("https://booklo.co/", "anna", "spaces")).toBe("https://booklo.co/anna/spaces");
  });
  it("bookingLink: a channel target is that channel's PAGE, not a query (spec 2026-08-28 §3.6)", () => {
    expect(bookingLink("https://booklo.co", "anna", { channel: "services" })).toBe("https://booklo.co/anna");
    expect(bookingLink("https://booklo.co", "anna", { channel: "spaces" })).toBe("https://booklo.co/anna/spaces");
  });
  it("embedSrc: every target is a query on the embed route", () => {
    expect(embedSrc("https://booklo.co", "anna")).toBe("https://booklo.co/embed/anna");
    expect(embedSrc("https://booklo.co/", "anna", { staff: "maria" })).toBe("https://booklo.co/embed/anna?staff=maria");
    expect(embedSrc("https://booklo.co", "anna", { space: "o1" })).toBe("https://booklo.co/embed/anna?space=o1");
    expect(embedSrc("https://booklo.co", "anna", { channel: "spaces" })).toBe("https://booklo.co/embed/anna?channel=spaces");
  });
});

// Source guard: nothing outside the legacy redirect folder builds a /book/
// URL by hand — the public page lives at /<handle> now. Walks every root
// that can hand-build a URL (src, scripts, workers — skipping one that
// doesn't exist), strips comments first so documentation prose mentioning
// /book/[handle] doesn't count as an offender, then flags any remaining
// /book/ literal in real code.
describe("no stray /book/ literals", () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  }
  function exists(dir: string): boolean {
    try {
      return statSync(dir).isDirectory();
    } catch {
      return false;
    }
  }
  function stripComments(source: string): string {
    // The line-comment branch skips `//` immediately preceded by `:` so a
    // URL scheme (`http://…`) isn't mistaken for a comment start — a scheme
    // occurring earlier on the line would otherwise delete everything after
    // it, including a real /book/ literal further along the same line.
    return source.replace(/\/\*[\s\S]*?\*\/|(?<!:)\/\/.*$/gm, "");
  }
  it("src, scripts, workers (except src/app/book and tests) never build a /book/ path", () => {
    const cwd = process.cwd();
    const roots = ["src", "scripts", "workers"].map((name) => join(cwd, name)).filter(exists);
    const offenders = roots
      .flatMap((root) => walk(root).map((p) => ({ root, p })))
      .filter(({ p }) => /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p))
      .filter(({ root, p }) => !relative(root, p).startsWith("app/book/"))
      .filter(({ p }) => /\/book\//.test(stripComments(readFileSync(p, "utf8"))))
      .map(({ p }) => relative(cwd, p));
    expect(offenders).toEqual([]);
  });
});
