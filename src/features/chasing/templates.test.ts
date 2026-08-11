import { describe, it, expect } from "vitest";
import { chaseEmail } from "./templates";

const base = {
  orgName: "Acme Fire & Safety <Ltd>",
  branding: { accentColor: "#c04030", logoUrl: null },
  programName: "Annual Inspection <2026>",
  unitLine: "Site 12",
  url: "https://app.example.com/p/tok123",
  stopUrl: "https://app.example.com/p/tok123/stop",
};

describe("chaseEmail", () => {
  it("escalates the subject across sends and ends with a final notice", () => {
    const subjects = [0, 1, 2, 3].map((i) => chaseEmail({ ...base, sendIndex: i }).subject);
    expect(new Set(subjects).size).toBe(4);
    expect(subjects[0]).toContain("Annual Inspection <2026>");
    expect(subjects[3].toLowerCase()).toContain("final");
  });

  it("html contains link, stop link, unit line, and escapes names", () => {
    const { html } = chaseEmail({ ...base, sendIndex: 1 });
    expect(html).toContain(base.url);
    expect(html).toContain(base.stopUrl);
    expect(html).toContain("Site 12");
    expect(html).toContain("Acme Fire &amp; Safety &lt;Ltd&gt;");
    expect(html).not.toContain("Acme Fire & Safety <Ltd>");
  });

  it("text version carries both links (clients that strip html)", () => {
    const { text } = chaseEmail({ ...base, sendIndex: 0 });
    expect(text).toContain(base.url);
    expect(text).toContain(base.stopUrl);
  });

  it("whole-program chase omits the unit line", () => {
    const { html } = chaseEmail({ ...base, sendIndex: 0, unitLine: null });
    expect(html).not.toContain("Site 12");
  });

  it("carries no participant name anywhere (dates-not-names discipline)", () => {
    const { html, text, subject } = chaseEmail({ ...base, sendIndex: 2 });
    for (const s of [html, text, subject]) expect(s).not.toMatch(/Dave/);
  });
});
