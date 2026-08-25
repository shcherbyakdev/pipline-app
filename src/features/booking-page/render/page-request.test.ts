import { describe, it, expect } from "vitest";
import { nextRequest, initialRequest } from "./page-request";

describe("page request reducer", () => {
  it("starts from the ?service= deep link, else ?space=, else empty; service wins when both are given", () => {
    expect(initialRequest("svc1")).toEqual({ kind: "service", id: "svc1", key: 1 });
    expect(initialRequest(null, "off1")).toEqual({ kind: "offering", id: "off1", key: 1 });
    expect(initialRequest("svc1", "off1")).toEqual({ kind: "service", id: "svc1", key: 1 });
    expect(initialRequest(null)).toBeNull();
    expect(initialRequest(null, null)).toBeNull();
  });
  it("every request gets a new key, so re-picking the same thing still lands", () => {
    const a = nextRequest(null, "service", "svc1");
    const b = nextRequest(a, "service", "svc1");
    expect(a).toEqual({ kind: "service", id: "svc1", key: 1 });
    expect(b).toEqual({ kind: "service", id: "svc1", key: 2 });
  });
  it("switches kind freely — a space after a service, and back", () => {
    const s = nextRequest(null, "service", "svc1");
    const o = nextRequest(s, "offering", "off1");
    expect(o).toEqual({ kind: "offering", id: "off1", key: 2 });
    expect(nextRequest(o, "service", "svc2")).toEqual({ kind: "service", id: "svc2", key: 3 });
  });
});
