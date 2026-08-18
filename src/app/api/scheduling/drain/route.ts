import { env } from "@/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectTransport } from "@/lib/email/transport";
import { isAuthorizedDrainRequest } from "@/features/chasing/drain-auth";
import { runReminderDrain } from "@/features/scheduling/reminders";
import { emailBadgeUrl } from "@/lib/billing/queries";

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
    const summary = await runReminderDrain({
      db: createAdminClient(),
      transport: selectTransport(),
      // Reminders carry the badge under the same rule as every other
      // client-facing mail (plan + the org's toggle).
      badgeFor: emailBadgeUrl,
    });
    return Response.json(summary);
  } catch (error) {
    console.error("[scheduling] drain tick failed:", error);
    return Response.json({ error: "drain failed" }, { status: 500 });
  }
}
