import { describe, it, expect } from "vitest";
import {
  createParticipantInput,
  issueLinkInput,
  participantSaveResponseInput,
} from "./schema";

const uuid = "550e8400-e29b-41d4-a716-446655440000";

describe("participants schemas", () => {
  it("createParticipant trims and bounds the name, validates email", () => {
    expect(createParticipantInput.safeParse({ name: "  Alex  " }).success).toBe(true);
    expect(createParticipantInput.safeParse({ name: " " }).success).toBe(false);
    expect(createParticipantInput.safeParse({ name: "A", email: "not-an-email" }).success).toBe(false);
  });

  it("issueLink defaults expiry to 30 days and bounds it", () => {
    const parsed = issueLinkInput.parse({ participantId: uuid, programId: uuid });
    expect(parsed.expiresDays).toBe(30);
    expect(issueLinkInput.safeParse({ participantId: uuid, programId: uuid, expiresDays: 0 }).success).toBe(false);
    expect(issueLinkInput.safeParse({ participantId: uuid, programId: uuid, expiresDays: 366 }).success).toBe(false);
  });

  it("participantSaveResponseInput requires a plausible token and typed value", () => {
    const ids = { token: "x".repeat(43), unitId: uuid, requirementId: uuid };
    expect(participantSaveResponseInput.safeParse({ ...ids, type: "text", value: "ok" }).success).toBe(true);
    expect(participantSaveResponseInput.safeParse({ ...ids, token: "short", type: "text", value: "ok" }).success).toBe(false);
    expect(participantSaveResponseInput.safeParse({ ...ids, type: "number", value: "3" }).success).toBe(false);
  });
});
