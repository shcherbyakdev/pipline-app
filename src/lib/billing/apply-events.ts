import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillingEvent } from "./provider";

// Idempotent, order-safe projection of provider events onto our cache
// (spec §7.5). All the work — recording the event, the unresolvable-org
// case, and the conditional upsert guarded by provider_updated_at — happens
// inside ONE definer RPC (apply_billing_event, 0043) so it is one
// transaction per event: no crash window between "event recorded" and
// "subscription updated", and the ordering guard (provider_updated_at <
// incoming) can't race a concurrent delivery the way a separate
// select-then-upsert from this client would. This function just orders the
// batch and tallies the RPC's per-event outcome.
export async function applyBillingEvents(
  admin: SupabaseClient, events: BillingEvent[],
): Promise<{ processed: number; skipped: number }> {
  let processed = 0, skipped = 0;
  const ordered = [...events].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  for (const ev of ordered) {
    const { data, error } = await admin.rpc("apply_billing_event", {
      p_provider: ev.provider,
      p_event_id: ev.providerEventId,
      p_occurred_at: ev.occurredAt,
      p_org_id: ev.orgId,
      p_type: ev.type,
      p_payload: ev.raw as object,
      p_sub: ev.subscription,
    });
    if (error) throw error;
    // 'processed' | 'replayed' | 'stale' | 'skipped' — only 'processed' moved
    // the org_subscriptions cache; everything else is a no-op we still count.
    if (data === "processed") processed += 1; else skipped += 1;
  }
  return { processed, skipped };
}
