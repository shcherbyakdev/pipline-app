import { env } from "@/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectTransport } from "@/lib/email/transport";
import { isAuthorizedDrainRequest } from "@/features/chasing/drain-auth";
import { runReminderDrain } from "@/features/scheduling/reminders";
import { emailBadgeUrl, getEntitlementsAdmin, monthlyBookingUsage } from "@/lib/billing/queries";
import { reminderQuotaExceeded } from "@/lib/billing/entitlements";
import { getOrgFlagsAdmin } from "@/lib/flags/resolve";

// A tick is up to REMINDER_BATCH_LIMIT (25) sequential sends plus a handful
// of reads per row; the platform default function budget is tighter than a
// slow Resend day needs. 60s matches the Worker's own request timeout
// (workers/cron DRAIN_TIMEOUT_MS), so neither side gives up before the other.
export const maxDuration = 60;

// Per-tick memo of a per-org lookup (reminders.ts's badge memo, same shape):
// a batch commonly comes from a handful of orgs, and these answers are per
// ORG, not per booking. Promises, not values, so two rows resolved in the
// same pass cannot both start a lookup. Created per request, so a flag
// flipped between ticks is seen by the next one.
function perOrg<T>(load: (orgId: string) => Promise<T>): (orgId: string) => Promise<T> {
  const cache = new Map<string, Promise<T>>();
  return (orgId) => {
    let pending = cache.get(orgId);
    if (!pending) {
      pending = load(orgId);
      cache.set(orgId, pending);
    }
    return pending;
  };
}

// Booking-reminder drain tick. Same operational model as /api/chase/drain:
// POST + Bearer secret now (scripts/scheduling-drain.ts), a cron
// (GH Actions / Vercel) later — same URL, same secret, no code change.
export async function POST(request: Request) {
  if (!env.SCHEDULING_DRAIN_SECRET) {
    return Response.json({ error: "drain disabled" }, { status: 503 });
  }
  if (!isAuthorizedDrainRequest(request.headers.get("authorization"), env.SCHEDULING_DRAIN_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const admin = createAdminClient();
    // getOrgFlagsAdmin / getEntitlementsAdmin are React-cache()d, but that
    // is only guaranteed to dedupe inside a render, and a drain loop is not
    // one — memoise explicitly rather than lean on it. monthlyBookingUsage is
    // NOT memoised: its answer moves with each booking's own created_at.
    const flagsFor = perOrg((orgId) => getOrgFlagsAdmin(orgId));
    const entitlementsFor = perOrg((orgId) => getEntitlementsAdmin(orgId));
    const summary = await runReminderDrain({
      db: admin,
      transport: selectTransport(),
      // Reminders carry the badge under the same rule as every other
      // client-facing mail (plan + the org's toggle).
      badgeFor: emailBadgeUrl,
      // Free-plan reminder quota (spec §7.10): checked per booking's org, not
      // once for the whole tick — a batch mixes orgs with billing on and off.
      //
      // Ordinal, not a running total: the count is "originals this org made
      // in the booking's own month BEFORE this booking", so the answer is
      // "is this the 31st?" — stable no matter when the tick runs or what
      // was cancelled since (spec §3, "the first 30 bookings each month").
      quotaExceeded: async (orgId, tz, createdAt) => {
        // Only metered once the ORG's billing flag is on — an org with billing
        // off is unmetered, same as the rest of its billing surface.
        if (!(await flagsFor(orgId)).billing) return false;
        return reminderQuotaExceeded(
          await monthlyBookingUsage(orgId, tz, new Date(createdAt), admin, { before: createdAt }),
          await entitlementsFor(orgId),
        );
      },
    });
    return Response.json(summary);
  } catch (error) {
    console.error("[scheduling] drain tick failed:", error);
    return Response.json({ error: "drain failed" }, { status: 500 });
  }
}
