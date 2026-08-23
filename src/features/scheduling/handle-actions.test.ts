import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/anon-server", () => ({
  createAnonServerClient: () => ({ rpc }),
}));
vi.mock("@/env", () => ({
  env: { NEXT_PUBLIC_SUPABASE_URL: "http://localhost", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" },
}));

import { checkHandle } from "./handle-actions";

beforeEach(() => {
  rpc.mockReset();
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
