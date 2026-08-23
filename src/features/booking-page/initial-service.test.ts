import { describe, it, expect } from "vitest";
import { resolveInitialService } from "./initial-service";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const services = [{ id: A }, { id: B }];

describe("resolveInitialService", () => {
  it("returns the id when it names a listed service", () => {
    expect(resolveInitialService(services, A)).toBe(A);
  });
  it("ignores unknown ids, non-uuids, arrays and absence", () => {
    expect(resolveInitialService(services, "33333333-3333-4333-8333-333333333333")).toBeNull();
    expect(resolveInitialService(services, "preview-service")).toBeNull();
    expect(resolveInitialService(services, [A])).toBeNull();
    expect(resolveInitialService(services, undefined)).toBeNull();
  });
});
