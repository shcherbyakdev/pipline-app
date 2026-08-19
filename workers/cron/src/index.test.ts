import { describe, expect, it, vi } from "vitest";
import { drainRequest, runDrain, type WorkerEnv } from "./index";

const ENV: WorkerEnv = {
  DRAIN_URL: "https://booklo.co/api/scheduling/drain",
  SCHEDULING_DRAIN_SECRET: "0123456789abcdef0123",
  HEALTHCHECK_URL: "https://hc-ping.com/abc",
};

describe("drainRequest", () => {
  it("POSTs to the drain url with a bearer token", () => {
    const req = drainRequest(ENV);
    expect(req.method).toBe("POST");
    expect(req.url).toBe(ENV.DRAIN_URL);
    expect(req.headers.get("authorization")).toBe(`Bearer ${ENV.SCHEDULING_DRAIN_SECRET}`);
  });
});

describe("runDrain", () => {
  it("pings the healthcheck after a successful drain", async () => {
    const calls: string[] = [];
    const fake = vi.fn(async (input: Request | string) => {
      calls.push(typeof input === "string" ? input : input.url);
      return new Response("{}", { status: 200 });
    });
    await expect(runDrain(ENV, fake as unknown as typeof fetch)).resolves.toBe(true);
    expect(calls).toEqual([ENV.DRAIN_URL, ENV.HEALTHCHECK_URL]);
  });

  // The healthcheck is the alarm. Pinging it on a failed drain would report
  // health while reminders silently stop — and the drain's traffic is also
  // what keeps the Free-tier project from pausing, so a silent failure ends
  // in the whole site going down about a week later.
  it("does NOT ping the healthcheck when the drain fails", async () => {
    const calls: string[] = [];
    const fake = vi.fn(async (input: Request | string) => {
      calls.push(typeof input === "string" ? input : input.url);
      return new Response("nope", { status: 500 });
    });
    await expect(runDrain(ENV, fake as unknown as typeof fetch)).resolves.toBe(false);
    expect(calls).toEqual([ENV.DRAIN_URL]);
  });
});
