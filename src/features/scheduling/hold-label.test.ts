import { describe, it, expect } from "vitest";
import { isLiveHold } from "./hold-label";

describe("isLiveHold", () => {
  const now = new Date("2027-05-10T10:00:00Z");
  it("a pending_payment row with a future deadline", () =>
    expect(isLiveHold({ status: "pending_payment", holdExpiresAt: "2027-05-10T10:30:00Z" }, now)).toBe(true));
  it("lapsed or any other status is not", () => {
    expect(isLiveHold({ status: "pending_payment", holdExpiresAt: "2027-05-10T09:59:00Z" }, now)).toBe(false);
    expect(isLiveHold({ status: "confirmed", holdExpiresAt: "2027-05-10T10:30:00Z" }, now)).toBe(false);
    expect(isLiveHold({ status: "pending_payment", holdExpiresAt: null }, now)).toBe(false);
  });
});
