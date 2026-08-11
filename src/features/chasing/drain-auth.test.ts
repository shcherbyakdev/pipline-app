import { describe, it, expect } from "vitest";
import { isAuthorizedDrainRequest } from "./drain-auth";

describe("isAuthorizedDrainRequest", () => {
  const secret = "super-secret-drain-key";
  it("accepts the exact bearer secret", () => {
    expect(isAuthorizedDrainRequest(`Bearer ${secret}`, secret)).toBe(true);
  });
  it("rejects wrong secret, malformed header, and missing header", () => {
    expect(isAuthorizedDrainRequest("Bearer nope", secret)).toBe(false);
    expect(isAuthorizedDrainRequest(secret, secret)).toBe(false);
    expect(isAuthorizedDrainRequest(null, secret)).toBe(false);
  });
  it("rejects EVERYTHING when no secret is configured (fail closed)", () => {
    expect(isAuthorizedDrainRequest("Bearer anything", undefined)).toBe(false);
  });
});
