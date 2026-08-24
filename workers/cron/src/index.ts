/* Reminder-drain scheduler (spec 2026-08-19-launch-infrastructure §7).
   Cloudflare Worker cron rather than Vercel Cron (Hobby is once-daily at an
   arbitrary time) or GitHub Actions (a 15-minute tick on a private repo
   exceeds the 2,000 free minutes/month). */

export type WorkerEnv = {
  DRAIN_URL: string;
  SCHEDULING_DRAIN_SECRET: string;
  HEALTHCHECK_URL: string;
};

// Matches the drain route's `maxDuration` (60s): a legitimately slow tick is
// never cut off from this side, while a hung upstream socket cannot hold the
// invocation open until Cloudflare's wall-clock limit ends it without a log
// line or a /fail ping.
export const DRAIN_TIMEOUT_MS = 60_000;

// healthchecks.io shows at most the first 100KB of a /fail body; the drain
// route's error envelope is a short JSON object, so a 1,000-char cap keeps
// the reason readable without ever mattering in practice.
const REASON_MAX_CHARS = 1_000;

export function drainRequest(env: WorkerEnv): Request {
  return new Request(env.DRAIN_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SCHEDULING_DRAIN_SECRET}` },
    signal: AbortSignal.timeout(DRAIN_TIMEOUT_MS),
  });
}

/** Log the failure and tell the healthcheck about it. `POST <url>/fail`
    flips the check to "down" immediately instead of after the grace period,
    and the body becomes the event's detail in the dashboard — the only
    record of WHY a tick failed once this invocation ends. Always false. */
async function reportFailure(env: WorkerEnv, fetchImpl: typeof fetch, reason: string): Promise<false> {
  console.error(`[cron] ${reason}`);
  try {
    await fetchImpl(`${env.HEALTHCHECK_URL}/fail`, {
      method: "POST",
      body: reason.slice(0, REASON_MAX_CHARS),
    });
  } catch (error) {
    console.error(`[cron] healthcheck /fail ping threw: ${error}`);
  }
  return false;
}

/** Returns whether the drain succeeded. The success URL is pinged ONLY on
    success: it is the alarm for a dead scheduler, and a dead scheduler also
    stops the database traffic that keeps a Free-tier project from pausing.
    A failed drain reports to /fail instead, so the alarm fires now rather
    than when the grace period runs out. */
export async function runDrain(env: WorkerEnv, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  let response: Response;
  try {
    response = await fetchImpl(drainRequest(env));
  } catch (error) {
    return reportFailure(env, fetchImpl, `drain request threw: ${error}`);
  }
  if (!response.ok) {
    return reportFailure(env, fetchImpl, `drain failed: ${response.status} ${await response.text()}`);
  }
  try {
    await fetchImpl(env.HEALTHCHECK_URL);
  } catch (error) {
    console.error(`[cron] healthcheck ping threw: ${error}`);
    return false;
  }
  return true;
}

/* Minimal local types for the two Cloudflare objects this handler touches.
   Deliberately NOT @cloudflare/workers-types: tsconfig.json includes all .ts
   files, so that package's globals would land in the Next app too, where
   they redefine Request/Response/fetch. Two structural types cost nothing and
   keep the blast radius at this file. */
type ScheduledEvent = { scheduledTime: number };
type ExecutionCtx = { waitUntil(promise: Promise<unknown>): void };

type WorkerModule = {
  scheduled(_event: ScheduledEvent, env: WorkerEnv, ctx: ExecutionCtx): Promise<void>;
};

const worker: WorkerModule = {
  async scheduled(_event: ScheduledEvent, env: WorkerEnv, ctx: ExecutionCtx) {
    ctx.waitUntil(runDrain(env));
  },
};

export default worker;
