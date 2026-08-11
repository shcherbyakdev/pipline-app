import { describe, it, expect } from "vitest";
import { parseUnitsCsv } from "./csv";
import { MAX_IMPORT_ROWS } from "./schema";

const ok = (text: string) => {
  const result = parseUnitsCsv(text);
  if (!result.ok) throw new Error(`expected ok, got: ${result.errors.join("; ")}`);
  return result.rows;
};
const errorsOf = (text: string) => {
  const result = parseUnitsCsv(text);
  if (result.ok) throw new Error("expected errors");
  return result.errors;
};

describe("parseUnitsCsv", () => {
  it("parses the happy path and trims values", () => {
    expect(ok("name,external_ref\n  Store #1  ,  S-1  \nStore #2,S-2")).toEqual([
      { name: "Store #1", externalRef: "S-1" },
      { name: "Store #2", externalRef: "S-2" },
    ]);
  });

  it("matches headers case-insensitively and ignores extra columns", () => {
    expect(ok("Name,External_Ref,City\nA,S-1,Kyiv")).toEqual([{ name: "A", externalRef: "S-1" }]);
  });

  it("strips a UTF-8 BOM", () => {
    expect(ok("﻿name,external_ref\nA,S-1")).toHaveLength(1);
  });

  it("handles quoted commas", () => {
    expect(ok('name,external_ref\n"Store, North",S-1')[0].name).toBe("Store, North");
  });

  it("rejects files missing required headers", () => {
    expect(errorsOf("name,ref\nA,S-1")[0]).toMatch(/name.*external_ref|external_ref/);
  });

  it("rejects empty files and files with no data rows", () => {
    expect(errorsOf("").length).toBeGreaterThan(0);
    expect(errorsOf("name,external_ref\n").length).toBeGreaterThan(0);
  });

  it("reports blank name / blank ref with spreadsheet row numbers", () => {
    const errors = errorsOf("name,external_ref\nA,S-1\n,S-2\nC,");
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/^Row 3: name/);
    expect(errors[1]).toMatch(/^Row 4: external_ref/);
  });

  it("reports over-length values", () => {
    const errors = errorsOf(`name,external_ref\n${"x".repeat(121)},S-1`);
    expect(errors[0]).toMatch(/^Row 2: name/);
  });

  it("reports in-file duplicate refs on every occurrence after the first", () => {
    const errors = errorsOf("name,external_ref\nA,S-1\nB,S-1\nC,S-1");
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/^Row 3: duplicate external_ref "S-1".*row 2/);
    expect(errors[1]).toMatch(/^Row 4: duplicate external_ref "S-1".*row 2/);
  });

  it("all-or-nothing: a single bad row yields errors, not rows", () => {
    expect(parseUnitsCsv("name,external_ref\nA,S-1\n,S-2").ok).toBe(false);
  });

  it(`caps at ${MAX_IMPORT_ROWS} rows`, () => {
    const body = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `U${i},S-${i}`).join("\n");
    expect(errorsOf(`name,external_ref\n${body}`)[0]).toMatch(/2000/);
  });
});
