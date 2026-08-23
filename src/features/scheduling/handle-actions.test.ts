import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
// The action throttles per client (x-forwarded-for). Each test gets its own
// address so the 20/min bucket never bleeds across tests; the throttle test
// pins one address on purpose.
const client = vi.hoisted(() => ({ ip: "10.0.0.1", n: 0 }));

vi.mock("@/lib/supabase/anon-server", () => ({
  createAnonServerClient: () => ({ rpc }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": client.ip }),
}));
vi.mock("@/env", () => ({
  env: { NEXT_PUBLIC_SUPABASE_URL: "http://localhost", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" },
}));

import { checkHandle } from "./handle-actions";

beforeEach(() => {
  rpc.mockReset();
  client.ip = `10.0.${Math.floor(client.n / 250)}.${client.n % 250}`;
  client.n += 1;
});

describe("checkHandle", () => {
  it("returns invalid without touching the DB for malformed or reserved input", async () => {
    expect(await checkHandle("Ab")).toEqual({ status: "invalid" });
    expect(await checkHandle("login")).toEqual({ status: "invalid" });
    expect(await checkHandle(42)).toEqual({ status: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns free when the RPC says so", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await checkHandle("anna")).toEqual({ status: "free" });
    expect(rpc).toHaveBeenCalledWith("is_handle_available", { p_handle: "anna" });
  });

  it("returns taken with the first free suggestion, at most three extra RPC calls", async () => {
    rpc
      .mockResolvedValueOnce({ data: false, error: null }) // anna
      .mockResolvedValueOnce({ data: false, error: null }) // anna-studio
      .mockResolvedValueOnce({ data: true, error: null }); // anna-booking
    expect(await checkHandle("anna")).toEqual({ status: "taken", suggestion: "anna-booking" });
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it("returns taken with no suggestion when every candidate is gone", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await checkHandle("anna")).toEqual({ status: "taken", suggestion: null });
    expect(rpc).toHaveBeenCalledTimes(4); // 1 + 3 candidates, never the 4th suffix
  });

  it("returns error (not taken) when the RPC fails", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await checkHandle("anna")).toEqual({ status: "error" });
  });
});

describe("checkHandle throttle", () => {
  it("refuses a client that exceeds the per-minute budget, without touching the DB", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    for (let i = 0; i < 20; i++) expect(await checkHandle("anna")).toEqual({ status: "free" });
    expect(await checkHandle("anna")).toEqual({ status: "error" });
    expect(rpc).toHaveBeenCalledTimes(20);
  });

  it("suggest: false answers taken without suggestion lookups", async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await checkHandle("anna", { suggest: false })).toEqual({ status: "taken", suggestion: null });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
