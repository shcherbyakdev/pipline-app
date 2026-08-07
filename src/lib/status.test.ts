import { describe, it, expect } from "vitest";
import { getStatusMeta, STATUS_ORDER } from "./status";

describe("getStatusMeta", () => {
  it("returns a human label for each status", () => {
    expect(getStatusMeta("not_started").label).toBe("Not started");
    expect(getStatusMeta("in_progress").label).toBe("In progress");
    expect(getStatusMeta("complete").label).toBe("Complete");
    expect(getStatusMeta("at_risk").label).toBe("At risk");
    expect(getStatusMeta("blocked").label).toBe("Blocked");
  });
  it("maps each status to a status-token className", () => {
    expect(getStatusMeta("blocked").className).toContain("status-blocked");
    expect(getStatusMeta("complete").className).toContain("status-complete");
  });
  it("STATUS_ORDER lists all five statuses once, blocked last", () => {
    expect(STATUS_ORDER).toHaveLength(5);
    expect(new Set(STATUS_ORDER).size).toBe(5);
    expect(STATUS_ORDER.at(-1)).toBe("blocked");
  });
});
