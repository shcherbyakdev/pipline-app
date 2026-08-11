import { describe, it, expect } from "vitest";
import { startChaseInput } from "./schema";

describe("startChaseInput", () => {
  it("accepts participant+program, unit optional", () => {
    const ok = startChaseInput.safeParse({
      participantId: "8f14e45f-ceea-4a7b-9c3d-1f2e3d4c5b6a",
      programId: "8f14e45f-ceea-4a7b-9c3d-1f2e3d4c5b6b",
    });
    expect(ok.success).toBe(true);
  });
  it("rejects non-uuid ids", () => {
    expect(startChaseInput.safeParse({ participantId: "x", programId: "y" }).success).toBe(false);
  });
});
