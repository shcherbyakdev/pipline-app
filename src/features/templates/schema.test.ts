import { describe, it, expect } from "vitest";
import {
  templateName,
  templateDescription,
  stageName,
  createTemplateInput,
  reorderStagesInput,
  addRequirementInput,
  renameRequirementInput,
  reorderRequirementsInput,
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
  it("accepts 80 chars", () => {
    expect(templateName.safeParse("x".repeat(80)).success).toBe(true);
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

describe("templateDescription", () => {
  it("accepts 500 chars", () => {
    expect(templateDescription.safeParse("x".repeat(500)).success).toBe(true);
  });
  it("rejects 501 chars", () => {
    expect(templateDescription.safeParse("x".repeat(501)).success).toBe(false);
  });
  it("trims surrounding whitespace", () => {
    expect(templateDescription.parse("  hi  ")).toBe("hi");
  });
});

describe("createTemplateInput", () => {
  it("description is optional", () => {
    expect(createTemplateInput.safeParse({ name: "A" }).success).toBe(true);
  });
  it("rejects description over 500 chars", () => {
    expect(
      createTemplateInput.safeParse({ name: "A", description: "x".repeat(501) }).success,
    ).toBe(false);
  });
});

describe("reorderStagesInput", () => {
  it("accepts valid templateId and unique stageIds", () => {
    expect(
      reorderStagesInput.safeParse({ templateId: UUID_A, stageIds: [UUID_A, UUID_B] }).success,
    ).toBe(true);
  });
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

describe("addRequirementInput", () => {
  const base = { templateStageId: "550e8400-e29b-41d4-a716-446655440000" };

  it("accepts a plain text requirement", () => {
    expect(
      addRequirementInput.safeParse({ ...base, type: "text", label: "Notes", required: true })
        .success,
    ).toBe(true);
  });

  it("rejects photo — not offered by the editor until slice 8", () => {
    expect(
      addRequirementInput.safeParse({ ...base, type: "photo", label: "Photo", required: true })
        .success,
    ).toBe(false);
  });

  it("choice requires >=2 options and forbids items", () => {
    expect(
      addRequirementInput.safeParse({ ...base, type: "choice", label: "Route", required: true })
        .success,
    ).toBe(false);
    expect(
      addRequirementInput.safeParse({
        ...base, type: "choice", label: "Route", required: true, options: ["Front"],
      }).success,
    ).toBe(false);
    expect(
      addRequirementInput.safeParse({
        ...base, type: "choice", label: "Route", required: true, options: ["Front", "Rear"],
      }).success,
    ).toBe(true);
  });

  it("checklist requires >=1 item; other types forbid options/items", () => {
    expect(
      addRequirementInput.safeParse({ ...base, type: "checklist", label: "Checks", required: true })
        .success,
    ).toBe(false);
    expect(
      addRequirementInput.safeParse({
        ...base, type: "checklist", label: "Checks", required: true, items: ["Power on"],
      }).success,
    ).toBe(true);
    expect(
      addRequirementInput.safeParse({
        ...base, type: "text", label: "Notes", required: true, options: ["x", "y"],
      }).success,
    ).toBe(false);
  });

  it("label is trimmed and bounded at 120", () => {
    expect(
      renameRequirementInput.safeParse({ id: base.templateStageId, label: "  " }).success,
    ).toBe(false);
    expect(
      renameRequirementInput.safeParse({ id: base.templateStageId, label: "x".repeat(121) })
        .success,
    ).toBe(false);
  });

  it("reorder rejects duplicate ids", () => {
    expect(
      reorderRequirementsInput.safeParse({
        templateStageId: base.templateStageId,
        requirementIds: [base.templateStageId, base.templateStageId],
      }).success,
    ).toBe(false);
  });
});
