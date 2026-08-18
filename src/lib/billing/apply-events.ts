import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillingEvent } from "./provider";

// Idempotent, order-safe projection of provider events onto our cache
// (spec §7.5). 1) record the event (unique → already processed → skip);
// 2) unresolvable org → recorded with error, no upsert; 3) upsert only if
// the event is newer than provider_updated_at.
export async function applyBillingEvents(
  admin: SupabaseClient, events: BillingEvent[],
): Promise<{ processed: number; skipped: number }> {
  let processed = 0, skipped = 0;
  const ordered = [...events].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  for (const ev of ordered) {
    const { error: insErr } = await admin.from("billing_events").insert({
      provider: ev.provider, provider_event_id: ev.providerEventId, org_id: ev.orgId,
      type: ev.type, payload: ev.raw as object, error: ev.orgId ? null : "unresolvable org",
    });
    if (insErr) {
      if (insErr.code === "23505") { skipped += 1; continue; } // replay
      throw insErr;
    }
    if (!ev.orgId || !ev.subscription) { skipped += 1; continue; }

    const { data: current, error: readErr } = await admin
      .from("org_subscriptions").select("provider_updated_at").eq("org_id", ev.orgId).maybeSingle();
    if (readErr) throw readErr;
    if (current && Date.parse(current.provider_updated_at) >= Date.parse(ev.occurredAt)) { skipped += 1; continue; }

    const s = ev.subscription;
    const { error: upErr } = await admin.from("org_subscriptions").upsert({
      org_id: ev.orgId, plan: s.plan, status: s.status, billing_interval: s.interval, seats: s.seats,
      provider: ev.provider, provider_customer_id: s.providerCustomerId, provider_subscription_id: s.providerSubscriptionId,
      current_period_end: s.currentPeriodEnd, cancel_at_period_end: s.cancelAtPeriodEnd,
      provider_updated_at: ev.occurredAt, updated_at: new Date().toISOString(),
    }, { onConflict: "org_id" });
    if (upErr) throw upErr;
    processed += 1;
  }
  return { processed, skipped };
}
