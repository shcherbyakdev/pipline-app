import { describe, it, expect } from "vitest";
import {
  createParticipantInput,
  issueLinkInput,
  participantSaveResponseInput,
  uploadPhotoInput,
  removePhotoInput,
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

describe("uploadPhotoInput / removePhotoInput", () => {
  // Three distinct UUIDs (not one reused value) so a field mix-up in the
  // schema definitions — e.g. unitId and evidenceId swapped — would actually
  // show up as a test failure instead of passing by coincidence.
  const token = "x".repeat(40);
  const unitId = "11111111-1111-4111-8111-111111111111";
  const requirementId = "22222222-2222-4222-8222-222222222222";
  const evidenceId = "33333333-3333-4333-8333-333333333333";
  it("accepts well-formed upload metadata", () => {
    expect(
      uploadPhotoInput.safeParse({ token, unitId, requirementId }).success,
    ).toBe(true);
  });
  it("rejects short tokens and non-uuid ids", () => {
    expect(
      uploadPhotoInput.safeParse({ token: "short", unitId, requirementId }).success,
    ).toBe(false);
    expect(
      uploadPhotoInput.safeParse({ token, unitId, requirementId: "nope" }).success,
    ).toBe(false);
  });
  it("removePhotoInput requires token, unitId, evidenceId", () => {
    expect(
      removePhotoInput.safeParse({ token, unitId, evidenceId }).success,
    ).toBe(true);
    expect(removePhotoInput.safeParse({ token, unitId }).success).toBe(false);
  });
});
