import "server-only";

import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { calendarSyncAllowed, clientFor, googleConfigured, listConnections } from "./connections";
import { runCalendarSyncDrain, supabaseSyncStore, type DrainSummary } from "./sync";

/* The two production entry points into the sync loop (spec 2026-09-05
   §2.2): the kick after a booking action, and the 15-minute tick. Both
   build the same deps; sync.ts itself has none. Absent Google config → a
   no-op summary, never a throw. */

const NOTHING: DrainSummary = { synced: 0, failed: 0, skipped: 0 };

export async function runCalendarSync(opts: { orgId?: string } = {}, db: SupabaseClient = createAdminClient()): Promise<DrainSummary> {
  if (!googleConfigured()) return NOTHING;
  return runCalendarSyncDrain(opts, {
    store: supabaseSyncStore(db),
    connectionsFor: (orgId) => listConnections(orgId, db),
    clientFor: (id) => clientFor(id, db),
    allowed: calendarSyncAllowed,
    appUrl: env.NEXT_PUBLIC_APP_URL,
  });
}

/** Call from a booking action's post-commit tail. Runs the org's pending
    rows once the response is sent (`after`), so Google sees the change in
    seconds while the action itself never waits on it or fails for it. The
    trigger already queued the row inside the booking's own transaction;
    if this kick is lost the tick catches up within fifteen minutes. */
export function kickCalendarSync(orgId: string): void {
  if (!googleConfigured()) return;
  after(async () => {
    try {
      await runCalendarSync({ orgId });
    } catch (error) {
      console.error("[calendar] kick failed:", error);
    }
  });
}
