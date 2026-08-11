import { NextResponse } from "next/server";
import { env } from "@/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectTransport } from "@/lib/email/transport";
import { isAuthorizedDrainRequest } from "@/features/chasing/drain-auth";
import { runDrain } from "@/features/chasing/drain";

// The chase engine's only trigger. Callers: scripts/chase-drain.ts locally;
// a cron (GH Actions / Vercel) later — same URL, same secret, no code change.
export async function POST(request: Request) {
  if (!env.CHASE_DRAIN_SECRET) {
    return NextResponse.json({ error: "drain not configured" }, { status: 503 });
  }
  if (!isAuthorizedDrainRequest(request.headers.get("authorization"), env.CHASE_DRAIN_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const summary = await runDrain({ db: createAdminClient(), transport: selectTransport() });
  return NextResponse.json(summary);
}
