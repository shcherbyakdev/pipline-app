import { NextResponse } from "next/server";
import { env } from "@/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectTransport } from "@/lib/email/transport";
import { isAuthorizedDrainRequest } from "@/features/chasing/drain-auth";
import { runDrain } from "@/features/chasing/drain";

// PARKED since the 2026-08-13 scheduling pivot: chasing is the legacy
// fire-safety pipeline's email engine (hidden, not deleted), and a
// production database has no rows for it. While parked the route answers a
// bare 404 before it reads any env — setting CHASE_DRAIN_SECRET alone must
// not be enough to arm an engine nothing in the product uses. Flip this
// constant to un-park; the original handler below is untouched.
const CHASE_DRAIN_PARKED = true;

// The chase engine's only trigger. Callers: scripts/chase-drain.ts locally;
// a cron (GH Actions / Vercel) later — same URL, same secret, no code change.
export async function POST(request: Request) {
  if (CHASE_DRAIN_PARKED) return new Response(null, { status: 404 });

  if (!env.CHASE_DRAIN_SECRET) {
    return NextResponse.json({ error: "drain not configured" }, { status: 503 });
  }
  if (!isAuthorizedDrainRequest(request.headers.get("authorization"), env.CHASE_DRAIN_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // scheduling/drain/route.ts idiom: a thrown tick is a logged 500, never an
  // unhandled rejection in the route handler.
  try {
    const summary = await runDrain({ db: createAdminClient(), transport: selectTransport() });
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[chasing] drain tick failed:", error);
    return NextResponse.json({ error: "drain failed" }, { status: 500 });
  }
}
