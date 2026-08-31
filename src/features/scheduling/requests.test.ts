import { describe, it, expect } from "vitest";
import { isPendingRequest, isExpiredRequest } from "./requests";

const NOW = new Date("2027-03-10T12:00:00Z");

describe("request helpers", () => {
  it("pending + future = live request", () => {
    const b = { status: "pending", startsAt: "2027-03-10T13:00:00Z" };
    expect(isPendingRequest(b, NOW)).toBe(true);
    expect(isExpiredRequest(b, NOW)).toBe(false);
  });
  it("pending + started = expired, not live", () => {
    const b = { status: "pending", startsAt: "2027-03-10T12:00:00Z" };
    expect(isPendingRequest(b, NOW)).toBe(false);
    expect(isExpiredRequest(b, NOW)).toBe(true);
  });
  it("confirmed is neither", () => {
    const b = { status: "confirmed", startsAt: "2027-03-10T13:00:00Z" };
    expect(isPendingRequest(b, NOW)).toBe(false);
    expect(isExpiredRequest(b, NOW)).toBe(false);
  });
});
