import { describe, it, expect } from "vitest";
import {
  createClientInput,
  renameClientInput,
  assignClientInput,
  issuePortalLinkInput,
} from "./schema";

describe("clients schemas", () => {
  it("trims and bounds client names", () => {
    expect(createClientInput.parse({ name: "  Acme  " }).name).toBe("Acme");
    expect(createClientInput.safeParse({ name: "" }).success).toBe(false);
    expect(createClientInput.safeParse({ name: "x".repeat(121) }).success).toBe(false);
  });

  it("rename requires a uuid id", () => {
    expect(renameClientInput.safeParse({ id: "nope", name: "A" }).success).toBe(false);
  });

  it("assign accepts null to unassign", () => {
    const parsed = assignClientInput.parse({
      unitId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
      clientId: null,
    });
    expect(parsed.clientId).toBeNull();
  });

  it("portal links default to 12 months and cap at 730 days", () => {
    const parsed = issuePortalLinkInput.parse({ clientId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff" });
    expect(parsed.expiresDays).toBe(365);
    expect(
      issuePortalLinkInput.safeParse({
        clientId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
        expiresDays: 999,
      }).success,
    ).toBe(false);
  });
});
