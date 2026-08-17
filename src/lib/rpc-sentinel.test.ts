import { describe, it, expect } from "vitest";
import { isRpcSentinel } from "./rpc-sentinel";

describe("isRpcSentinel", () => {
  it("matches the bare sentinel PostgREST hands back", () => {
    // Exactly the wire shape: {"code":"P0001","message":"staff_unavailable"}.
    expect(isRpcSentinel({ message: "staff_unavailable" }, "staff_unavailable")).toBe(true);
    expect(isRpcSentinel({ message: "taken" }, "taken")).toBe(true);
  });

  it("tolerates surrounding whitespace", () => {
    expect(isRpcSentinel({ message: " taken\n" }, "taken")).toBe(true);
  });

  // The reason for the tightening: an unrelated error whose text merely
  // contains the word must not be relabelled as our sentinel.
  it("does not match a message that only contains the word", () => {
    expect(isRpcSentinel({ message: 'column "taken" does not exist' }, "taken")).toBe(false);
    expect(isRpcSentinel({ message: "could not obtain lock: already taken" }, "taken")).toBe(false);
    expect(isRpcSentinel({ message: "staff_unavailable_v2" }, "staff_unavailable")).toBe(false);
  });

  it("handles a missing message and a missing error", () => {
    expect(isRpcSentinel({ message: null }, "taken")).toBe(false);
    expect(isRpcSentinel({}, "taken")).toBe(false);
    expect(isRpcSentinel(null, "taken")).toBe(false);
    expect(isRpcSentinel(undefined, "taken")).toBe(false);
  });
});
