import { describe, it, expect } from "vitest";
import { snippetFor } from "./widget-embed-snippet";

describe("snippetFor", () => {
  const snippet = snippetFor("https://app.example.com", "acme-studio");

  it("interpolates appUrl and handle into the iframe src", () => {
    expect(snippet).toContain('src="https://app.example.com/embed/acme-studio"');
  });

  it("interpolates appUrl into the script src", () => {
    expect(snippet).toContain('src="https://app.example.com/embed.js"');
  });

  it("carries the data-rollout-embed attribute embed.js selects iframes by", () => {
    expect(snippet).toContain("data-rollout-embed");
  });

  it("marks the script async so the pasted snippet doesn't parser-block the host page", () => {
    expect(snippet).toMatch(/<script src="[^"]+" async><\/script>/);
  });
});

describe("snippetFor with a staff slug", () => {
  it("appends ?staff=<slug> to the iframe src", () => {
    expect(snippetFor("https://app.example.com", "acme-studio", "anna")).toContain(
      'src="https://app.example.com/embed/acme-studio?staff=anna"',
    );
  });

  it("leaves the script src alone", () => {
    expect(snippetFor("https://app.example.com", "acme-studio", "anna")).toContain(
      'src="https://app.example.com/embed.js"',
    );
  });

  it("is unchanged when the slug is null/undefined (whole-team embed)", () => {
    const plain = snippetFor("https://app.example.com", "acme-studio");
    expect(snippetFor("https://app.example.com", "acme-studio", null)).toBe(plain);
    expect(plain).toContain('src="https://app.example.com/embed/acme-studio"');
    expect(plain).not.toContain("?staff=");
  });
});
