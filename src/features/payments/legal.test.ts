import { describe, it, expect } from "vitest";
import { legalSchema, parseLegal } from "./legal";

describe("legal", () => {
  it("accepts a partial object with http(s) links", () => {
    expect(legalSchema.parse({ legalName: "Studio X sp. z o.o.", taxId: "5252525252", termsUrl: "https://x.pl/regulamin" })).toEqual({ legalName: "Studio X sp. z o.o.", taxId: "5252525252", termsUrl: "https://x.pl/regulamin" });
  });
  it("rejects non-http links and drops empty strings", () => {
    expect(legalSchema.safeParse({ termsUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(legalSchema.parse({ address: "", regNo: "  " })).toEqual({});
  });
  it("parseLegal never throws", () => {
    expect(parseLegal(null)).toEqual({});
    expect(parseLegal({ legalName: 5 })).toEqual({});
    expect(parseLegal({ legalName: "S" })).toEqual({ legalName: "S" });
  });
});
