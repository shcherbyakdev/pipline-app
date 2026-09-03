import { describe, it, expect } from "vitest";
import { embedSnippet } from "./widget-embed-snippet";
import en from "../../../../messages/en.json";
import uk from "../../../../messages/uk.json";

const APP = "https://app.example.com";
// The org's public titles (public.embedTitle.*), resolved by the page.
const T = { appointment: "Book an appointment", space: "Book a space" };
const APPTS_ONLY = { offersAppointments: true, offersRentals: false };
const RENTALS_ONLY = { offersAppointments: false, offersRentals: true };
const BOTH = { offersAppointments: true, offersRentals: true };

describe("embedSnippet", () => {
  const snippet = embedSnippet(APP, "acme-studio", undefined, undefined, T);

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
    expect(embedSnippet(APP, "acme-studio", null, undefined, T)).toBe(snippet);
    expect(snippet).not.toContain("?");
  });
});

describe("embedSnippet targets (spec §5)", () => {
  it("staff pins the embed via ?staff=<slug> and leaves the script src alone", () => {
    const s = embedSnippet(APP, "acme-studio", { staff: "anna" }, undefined, T);
    expect(s).toContain('src="https://app.example.com/embed/acme-studio?staff=anna"');
    expect(s).toContain('src="https://app.example.com/embed.js"');
  });
  it("service, space and channel become the matching query", () => {
    expect(embedSnippet(APP, "acme", { service: "s1" }, undefined, T)).toContain('src="https://app.example.com/embed/acme?service=s1"');
    expect(embedSnippet(APP, "acme", { space: "o1" }, undefined, T)).toContain('src="https://app.example.com/embed/acme?space=o1"');
    expect(embedSnippet(APP, "acme", { channel: "services" }, undefined, T)).toContain('src="https://app.example.com/embed/acme?channel=services"');
  });
});

describe("embedSnippet iframe title", () => {
  it("no target: follows the org's channels, historical default without a mode", () => {
    expect(embedSnippet(APP, "acme", null, APPTS_ONLY, T)).toContain('title="Book an appointment"');
    expect(embedSnippet(APP, "acme", null, RENTALS_ONLY, T)).toContain('title="Book a space"');
    // A both-channel org's plain embed is its front door — appointments.
    expect(embedSnippet(APP, "acme", null, BOTH, T)).toContain('title="Book an appointment"');
    expect(embedSnippet(APP, "acme", undefined, undefined, T)).toContain('title="Book an appointment"');
  });
  it("a target names its own channel, whatever the org's mode", () => {
    expect(embedSnippet(APP, "acme", { space: "o1" }, BOTH, T)).toContain('title="Book a space"');
    expect(embedSnippet(APP, "acme", { channel: "spaces" }, BOTH, T)).toContain('title="Book a space"');
    expect(embedSnippet(APP, "acme", { service: "s1" }, BOTH, T)).toContain('title="Book an appointment"');
    expect(embedSnippet(APP, "acme", { staff: "anna" }, BOTH, T)).toContain('title="Book an appointment"');
    expect(embedSnippet(APP, "acme", { channel: "services" }, RENTALS_ONLY, T)).toContain('title="Book an appointment"');
  });
});

describe("embedSnippet trailing-slash appUrl", () => {
  it("no double slash in either src, whatever appUrl's trailing slashes", () => {
    const s = embedSnippet("https://app.example.com/", "acme", undefined, undefined, T);
    expect(s).toContain('src="https://app.example.com/embed/acme"');
    expect(s).toContain('src="https://app.example.com/embed.js"');
    expect(s).not.toContain("//embed");
  });
});

describe("embedSnippet attribute safety", () => {
  it("a 40-char handle and a long staff slug yield exactly two src= and eight quote characters", () => {
    const handle = "a".repeat(40);
    const s = embedSnippet(APP, handle, { staff: "a-very-long-slug-with-dashes-1234567890" }, undefined, T);
    expect(s.match(/src="/g)).toHaveLength(2);
    expect(s.match(/"/g)).toHaveLength(8);
  });
  it("no locale's titles carry a double quote, so the count above holds for every org language", () => {
    for (const messages of [en, uk]) {
      for (const title of Object.values(messages.embedTitle)) expect(title).not.toContain('"');
    }
  });
});
