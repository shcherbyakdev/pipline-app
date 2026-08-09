import { describe, it, expect } from "vitest";
import {
  templateName,
  stageName,
  createTemplateInput,
  reorderStagesInput,
} from "./schema";

const UUID_A = "6f1e2d3c-4b5a-4678-9abc-def012345678";
const UUID_B = "0a1b2c3d-4e5f-4671-8123-456789abcdef";

describe("templateName", () => {
  it("trims and accepts 1–80 chars", () => {
    expect(templateName.parse("  Store Refresh  ")).toBe("Store Refresh");
  });
  it("rejects empty after trim", () => {
    expect(templateName.safeParse("   ").success).toBe(false);
  });
  it("rejects 81 chars", () => {
    expect(templateName.safeParse("x".repeat(81)).success).toBe(false);
  });
});

describe("stageName", () => {
  it("rejects 61 chars, accepts 60", () => {
    expect(stageName.safeParse("x".repeat(61)).success).toBe(false);
    expect(stageName.safeParse("x".repeat(60)).success).toBe(true);
  });
});

describe("createTemplateInput", () => {
  it("description is optional", () => {
    expect(createTemplateInput.safeParse({ name: "A" }).success).toBe(true);
  });
});

describe("reorderStagesInput", () => {
  it("rejects a non-uuid templateId", () => {
    expect(
      reorderStagesInput.safeParse({ templateId: "nope", stageIds: [UUID_A] }).success,
    ).toBe(false);
  });
  it("rejects an empty stageIds array", () => {
    expect(
      reorderStagesInput.safeParse({ templateId: UUID_A, stageIds: [] }).success,
    ).toBe(false);
  });
  it("rejects duplicate stage ids", () => {
    expect(
      reorderStagesInput.safeParse({ templateId: UUID_A, stageIds: [UUID_B, UUID_B] }).success,
    ).toBe(false);
  });
});
