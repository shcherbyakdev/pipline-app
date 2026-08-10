import { describe, it, expect } from "vitest";
import {
  programName,
  unitName,
  externalRef,
  createProgramInput,
  renameProgramInput,
  deleteProgramInput,
  addUnitInput,
  renameUnitInput,
  deleteUnitInput,
  setUnitStageStatusInput,
  saveResponseInput,
} from "./schema";

const UUID = "6f1e2d3c-4b5a-4678-9abc-def012345678";

describe("programName", () => {
  it("trims and accepts 1–80", () => {
    expect(programName.parse("  Q3 Refresh  ")).toBe("Q3 Refresh");
    expect(programName.safeParse("x".repeat(80)).success).toBe(true);
  });
  it("rejects empty-after-trim and 81", () => {
    expect(programName.safeParse("   ").success).toBe(false);
    expect(programName.safeParse("x".repeat(81)).success).toBe(false);
  });
});

describe("unitName / externalRef", () => {
  it("unitName bounds 1–120", () => {
    expect(unitName.safeParse("x".repeat(120)).success).toBe(true);
    expect(unitName.safeParse("x".repeat(121)).success).toBe(false);
  });
  it("externalRef allows empty-after-trim and caps at 120", () => {
    expect(externalRef.parse("  S-101  ")).toBe("S-101");
    expect(externalRef.parse("   ")).toBe("");
    expect(externalRef.safeParse("x".repeat(121)).success).toBe(false);
  });
});

describe("createProgramInput", () => {
  it("happy path parses", () => {
    expect(createProgramInput.safeParse({ templateId: UUID, name: "Q3" }).success).toBe(true);
  });
  it("rejects non-uuid templateId", () => {
    expect(createProgramInput.safeParse({ templateId: "nope", name: "Q3" }).success).toBe(false);
  });
});

describe("addUnitInput", () => {
  it("externalRef is optional; happy path parses", () => {
    expect(addUnitInput.safeParse({ programId: UUID, name: "Store #101" }).success).toBe(true);
    expect(
      addUnitInput.safeParse({ programId: UUID, name: "Store #101", externalRef: "S-101" }).success,
    ).toBe(true);
  });
});

describe("remaining action inputs", () => {
  it("renameProgramInput happy path and rejects invalid uuid", () => {
    expect(renameProgramInput.safeParse({ id: UUID, name: "Q4" }).success).toBe(true);
    expect(renameProgramInput.safeParse({ id: "nope", name: "Q4" }).success).toBe(false);
  });
  it("deleteProgramInput happy path and rejects invalid uuid", () => {
    expect(deleteProgramInput.safeParse({ id: UUID }).success).toBe(true);
    expect(deleteProgramInput.safeParse({ id: "nope" }).success).toBe(false);
  });
  it("renameUnitInput happy path and rejects invalid uuid", () => {
    expect(renameUnitInput.safeParse({ id: UUID, name: "Store #102" }).success).toBe(true);
    expect(renameUnitInput.safeParse({ id: "nope", name: "Store #102" }).success).toBe(false);
  });
  it("deleteUnitInput happy path and rejects invalid uuid", () => {
    expect(deleteUnitInput.safeParse({ id: UUID }).success).toBe(true);
    expect(deleteUnitInput.safeParse({ id: "nope" }).success).toBe(false);
  });
});

describe("setUnitStageStatusInput", () => {
  it("happy path parses for both directions", () => {
    expect(setUnitStageStatusInput.safeParse({ id: UUID, done: true }).success).toBe(true);
    expect(setUnitStageStatusInput.safeParse({ id: UUID, done: false }).success).toBe(true);
  });
  it("rejects invalid uuid and non-boolean done", () => {
    expect(setUnitStageStatusInput.safeParse({ id: "nope", done: true }).success).toBe(false);
    expect(setUnitStageStatusInput.safeParse({ id: UUID, done: "yes" }).success).toBe(false);
  });
});

describe("saveResponseInput", () => {
  const ids = {
    unitStageId: "550e8400-e29b-41d4-a716-446655440000",
    requirementId: "550e8400-e29b-41d4-a716-446655440001",
  };

  it("types the value per requirement type", () => {
    expect(saveResponseInput.safeParse({ ...ids, type: "text", value: "ok" }).success).toBe(true);
    expect(saveResponseInput.safeParse({ ...ids, type: "number", value: 3 }).success).toBe(true);
    expect(saveResponseInput.safeParse({ ...ids, type: "boolean", value: true }).success).toBe(true);
    expect(saveResponseInput.safeParse({ ...ids, type: "date", value: "2027-03-14" }).success).toBe(true);
    expect(saveResponseInput.safeParse({ ...ids, type: "number", value: "3" }).success).toBe(false);
    expect(saveResponseInput.safeParse({ ...ids, type: "date", value: "14/03/2027" }).success).toBe(false);
    expect(saveResponseInput.safeParse({ ...ids, type: "text", value: "  " }).success).toBe(false);
  });

  it("choice variant accepts valid values and rejects over-length", () => {
    expect(saveResponseInput.safeParse({ ...ids, type: "choice", value: "Front" }).success).toBe(true);
    expect(saveResponseInput.safeParse({ ...ids, type: "choice", value: "x".repeat(121) }).success).toBe(false);
  });
});
