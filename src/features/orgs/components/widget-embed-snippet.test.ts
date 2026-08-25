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

describe("snippetFor iframe title follows the org's channels", () => {
  const APPTS_ONLY = { offersAppointments: true, offersRentals: false };
  const RENTALS_ONLY = { offersAppointments: false, offersRentals: true };
  const BOTH = { offersAppointments: true, offersRentals: true };

  it("appointments-only keeps the historical title", () => {
    expect(snippetFor("https://app.example.com", "acme", null, APPTS_ONLY)).toContain('title="Book an appointment"');
  });

  it("rentals-only says space, not appointment", () => {
    expect(snippetFor("https://app.example.com", "acme", null, RENTALS_ONLY)).toContain('title="Book a space"');
  });

  it("both channels use the neutral title", () => {
    expect(snippetFor("https://app.example.com", "acme", null, BOTH)).toContain('title="Book online"');
  });

  it("no mode given ⇒ the historical title (existing callers/tests unchanged)", () => {
    expect(snippetFor("https://app.example.com", "acme")).toContain('title="Book an appointment"');
  });
});
