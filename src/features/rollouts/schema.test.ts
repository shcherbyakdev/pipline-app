import { describe, it, expect } from "vitest";
import {
  rolloutName,
  unitName,
  externalRef,
  createRolloutInput,
  renameRolloutInput,
  deleteRolloutInput,
  addUnitInput,
  renameUnitInput,
  deleteUnitInput,
  setUnitStageStatusInput,
} from "./schema";

const UUID = "6f1e2d3c-4b5a-4678-9abc-def012345678";

describe("rolloutName", () => {
  it("trims and accepts 1–80", () => {
    expect(rolloutName.parse("  Q3 Refresh  ")).toBe("Q3 Refresh");
    expect(rolloutName.safeParse("x".repeat(80)).success).toBe(true);
  });
  it("rejects empty-after-trim and 81", () => {
    expect(rolloutName.safeParse("   ").success).toBe(false);
    expect(rolloutName.safeParse("x".repeat(81)).success).toBe(false);
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

describe("createRolloutInput", () => {
  it("happy path parses", () => {
    expect(createRolloutInput.safeParse({ templateId: UUID, name: "Q3" }).success).toBe(true);
  });
  it("rejects non-uuid templateId", () => {
    expect(createRolloutInput.safeParse({ templateId: "nope", name: "Q3" }).success).toBe(false);
  });
});

describe("addUnitInput", () => {
  it("externalRef is optional; happy path parses", () => {
    expect(addUnitInput.safeParse({ rolloutId: UUID, name: "Store #101" }).success).toBe(true);
    expect(
      addUnitInput.safeParse({ rolloutId: UUID, name: "Store #101", externalRef: "S-101" }).success,
    ).toBe(true);
  });
});

describe("remaining action inputs", () => {
  it("renameRolloutInput happy path and rejects invalid uuid", () => {
    expect(renameRolloutInput.safeParse({ id: UUID, name: "Q4" }).success).toBe(true);
    expect(renameRolloutInput.safeParse({ id: "nope", name: "Q4" }).success).toBe(false);
  });
  it("deleteRolloutInput happy path and rejects invalid uuid", () => {
    expect(deleteRolloutInput.safeParse({ id: UUID }).success).toBe(true);
    expect(deleteRolloutInput.safeParse({ id: "nope" }).success).toBe(false);
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
