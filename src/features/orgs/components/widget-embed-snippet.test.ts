import { describe, it, expect } from "vitest";
import { embedSnippet } from "./widget-embed-snippet";

const APP = "https://app.example.com";
const APPTS_ONLY = { offersAppointments: true, offersRentals: false };
const RENTALS_ONLY = { offersAppointments: false, offersRentals: true };
const BOTH = { offersAppointments: true, offersRentals: true };

describe("embedSnippet", () => {
  const snippet = embedSnippet(APP, "acme-studio");

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
  it("is byte-identical for a null target (whole-team embed)", () => {
    expect(embedSnippet(APP, "acme-studio", null)).toBe(snippet);
    expect(snippet).not.toContain("?");
  });
});

describe("embedSnippet targets (spec §5)", () => {
  it("staff pins the embed via ?staff=<slug> and leaves the script src alone", () => {
    const s = embedSnippet(APP, "acme-studio", { staff: "anna" });
    expect(s).toContain('src="https://app.example.com/embed/acme-studio?staff=anna"');
    expect(s).toContain('src="https://app.example.com/embed.js"');
  });
  it("service, space and channel become the matching query", () => {
    expect(embedSnippet(APP, "acme", { service: "s1" })).toContain('src="https://app.example.com/embed/acme?service=s1"');
    expect(embedSnippet(APP, "acme", { space: "o1" })).toContain('src="https://app.example.com/embed/acme?space=o1"');
    expect(embedSnippet(APP, "acme", { channel: "services" })).toContain('src="https://app.example.com/embed/acme?channel=services"');
  });
});

describe("embedSnippet iframe title", () => {
  it("no target: follows the org's channels, historical default without a mode", () => {
    expect(embedSnippet(APP, "acme", null, APPTS_ONLY)).toContain('title="Book an appointment"');
    expect(embedSnippet(APP, "acme", null, RENTALS_ONLY)).toContain('title="Book a space"');
    expect(embedSnippet(APP, "acme", null, BOTH)).toContain('title="Book online"');
    expect(embedSnippet(APP, "acme")).toContain('title="Book an appointment"');
  });
  it("a target names its own channel, whatever the org's mode", () => {
    expect(embedSnippet(APP, "acme", { space: "o1" }, BOTH)).toContain('title="Book a space"');
    expect(embedSnippet(APP, "acme", { channel: "spaces" }, BOTH)).toContain('title="Book a space"');
    expect(embedSnippet(APP, "acme", { service: "s1" }, BOTH)).toContain('title="Book an appointment"');
    expect(embedSnippet(APP, "acme", { staff: "anna" }, BOTH)).toContain('title="Book an appointment"');
    expect(embedSnippet(APP, "acme", { channel: "services" }, RENTALS_ONLY)).toContain('title="Book an appointment"');
  });
});
