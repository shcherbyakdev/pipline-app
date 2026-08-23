import { describe, expect, it, vi } from "vitest";
import { drainRequest, runDrain, type WorkerEnv } from "./index";

const ENV: WorkerEnv = {
  DRAIN_URL: "https://booklo.co/api/scheduling/drain",
  SCHEDULING_DRAIN_SECRET: "0123456789abcdef0123",
  HEALTHCHECK_URL: "https://hc-ping.com/abc",
};

const FAIL_URL = `${ENV.HEALTHCHECK_URL}/fail`;

type Call = { url: string; method: string; body: string | null };

// Records every fetch as (url, method, body) so the tests can assert not just
// WHICH endpoint was hit but that /fail carried the reason as a POST body.
function recordingFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fake = vi.fn(async (input: Request | string, init?: RequestInit) => {
    const call: Call =
      typeof input === "string"
        ? { url: input, method: init?.method ?? "GET", body: (init?.body as string | undefined) ?? null }
        : { url: input.url, method: input.method, body: null };
    calls.push(call);
    return respond(call);
  });
  return { calls, fetch: fake as unknown as typeof fetch };
}

describe("drainRequest", () => {
  it("POSTs to the drain url with a bearer token", () => {
    const req = drainRequest(ENV);
    expect(req.method).toBe("POST");
    expect(req.url).toBe(ENV.DRAIN_URL);
    expect(req.headers.get("authorization")).toBe(`Bearer ${ENV.SCHEDULING_DRAIN_SECRET}`);
  });

  // A hung upstream socket would otherwise hold the invocation open until
  // Cloudflare's wall-clock limit ends it with no log line and no /fail ping.
  it("carries a timeout signal", () => {
    const req = drainRequest(ENV);
    expect(req.signal).toBeInstanceOf(AbortSignal);
    expect(req.signal.aborted).toBe(false);
  });
});

describe("runDrain", () => {
  it("pings the healthcheck after a successful drain", async () => {
    const { calls, fetch } = recordingFetch(() => new Response("{}", { status: 200 }));
    await expect(runDrain(ENV, fetch)).resolves.toBe(true);
    expect(calls.map((c) => c.url)).toEqual([ENV.DRAIN_URL, ENV.HEALTHCHECK_URL]);
  });

  // The success URL is the alarm. Pinging it on a failed drain would report
  // health while reminders silently stop — and the drain's traffic is also
  // what keeps the Free-tier project from pausing, so a silent failure ends
  // in the whole site going down about a week later. /fail is the opposite:
  // it flips the check to "down" immediately, with the reason attached.
  it("reports a failed drain to /fail with the status and body, never the success url", async () => {
    const { calls, fetch } = recordingFetch((call) =>
      call.url === ENV.DRAIN_URL
        ? new Response('{"error":"drain failed"}', { status: 500 })
        : new Response("OK", { status: 200 }),
    );
    await expect(runDrain(ENV, fetch)).resolves.toBe(false);
    expect(calls.map((c) => c.url)).toEqual([ENV.DRAIN_URL, FAIL_URL]);
    expect(calls[1].method).toBe("POST");
    expect(calls[1].body).toContain("500");
    expect(calls[1].body).toContain("drain failed");
  });

  it("reports a thrown drain request to /fail with the error, never the success url", async () => {
    const { calls, fetch } = recordingFetch((call) => {
      if (call.url === ENV.DRAIN_URL) throw new Error("DNS failure");
      return new Response("OK", { status: 200 });
    });
    await expect(runDrain(ENV, fetch)).resolves.toBe(false);
    expect(calls.map((c) => c.url)).toEqual([ENV.DRAIN_URL, FAIL_URL]);
    expect(calls[1].method).toBe("POST");
    expect(calls[1].body).toContain("DNS failure");
  });

  it("still resolves false when the /fail report itself throws", async () => {
    const { calls, fetch } = recordingFetch((call) => {
      if (call.url === ENV.DRAIN_URL) return new Response("nope", { status: 503 });
      throw new Error("healthcheck connection refused");
    });
    await expect(runDrain(ENV, fetch)).resolves.toBe(false);
    expect(calls.map((c) => c.url)).toEqual([ENV.DRAIN_URL, FAIL_URL]);
  });

  it("resolves false when the healthcheck ping throws", async () => {
    const { calls, fetch } = recordingFetch((call) => {
      if (call.url === ENV.DRAIN_URL) return new Response("{}", { status: 200 });
      throw new Error("healthcheck connection refused");
    });
    await expect(runDrain(ENV, fetch)).resolves.toBe(false);
    // No /fail after a successful drain: the ping failing is the healthcheck
    // being unreachable, which /fail could not reach either.
    expect(calls.map((c) => c.url)).toEqual([ENV.DRAIN_URL, ENV.HEALTHCHECK_URL]);
  });
});
