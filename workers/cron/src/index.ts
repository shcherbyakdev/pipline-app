/* Reminder-drain scheduler (spec 2026-08-19-launch-infrastructure §7).
   Cloudflare Worker cron rather than Vercel Cron (Hobby is once-daily at an
   arbitrary time) or GitHub Actions (a 15-minute tick on a private repo
   exceeds the 2,000 free minutes/month). */

export type WorkerEnv = {
  DRAIN_URL: string;
  SCHEDULING_DRAIN_SECRET: string;
  HEALTHCHECK_URL: string;
};

export function drainRequest(env: WorkerEnv): Request {
  return new Request(env.DRAIN_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SCHEDULING_DRAIN_SECRET}` },
  });
}

/** Returns whether the drain succeeded. The healthcheck is pinged ONLY on
    success: it is the alarm for a dead scheduler, and a dead scheduler also
    stops the database traffic that keeps a Free-tier project from pausing. */
export async function runDrain(env: WorkerEnv, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const response = await fetchImpl(drainRequest(env));
  if (!response.ok) {
    console.error(`[cron] drain failed: ${response.status} ${await response.text()}`);
    return false;
  }
  await fetchImpl(env.HEALTHCHECK_URL);
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
