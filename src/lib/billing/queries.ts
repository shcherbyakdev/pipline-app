import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseWidgetTheme } from "@/lib/widget-theme";
import { badgeShows, entitlementsFor, monthWindow, type Entitlements, type OrgSubscriptionRow } from "./entitlements";
import { isPaidPlan } from "./plans";
import { BILLING_ENABLED } from "@/lib/flags";
import { env } from "@/env";

const SUB_COLS = "plan, status, billing_interval, seats, current_period_end, cancel_at_period_end";

// Works with the RLS client (dashboard: policy scopes to the member's org)
// and the admin client (public/drain paths: caller resolved orgId already).
export async function getOrgSubscription(orgId: string, client: SupabaseClient): Promise<OrgSubscriptionRow | null> {
  const { data, error } = await client.from("org_subscriptions").select(SUB_COLS).eq("org_id", orgId).maybeSingle();
  if (error) throw error;
  if (!data || !isPaidPlan(data.plan)) return null;
  return {
    plan: data.plan,
    status: data.status as OrgSubscriptionRow["status"],
    interval: data.billing_interval as OrgSubscriptionRow["interval"],
    seats: data.seats,
    currentPeriodEnd: data.current_period_end,
    cancelAtPeriodEnd: data.cancel_at_period_end,
  };
}

export async function getEntitlements(orgId: string, client: SupabaseClient, now = new Date()): Promise<Entitlements> {
  return entitlementsFor(await getOrgSubscription(orgId, client), now);
}

/** Public/drain paths. Per-request memoised. Degrades to Free on failure —
    a broken billing read must never break a booking page (spec §7.10). */
export const getEntitlementsAdmin = cache(async (orgId: string, now = new Date()): Promise<Entitlements> => {
  try {
    return await getEntitlements(orgId, createAdminClient(), now);
  } catch (error) {
    console.error("[billing] entitlements read failed (treating as Free):", error);
    return entitlementsFor(null, now);
  }
});

/** Same read, but it THROWS instead of degrading. For callers whose safe
    default is not Free: the public offering fails OPEN (a billing outage must
    not shrink a paying org's booking page), so it needs to know the read
    failed rather than be handed Free limits. Badge and reminder paths keep
    using getEntitlementsAdmin above, where Free IS the safe default. */
export const getEntitlementsAdminStrict = cache(
  async (orgId: string, now = new Date()): Promise<Entitlements> =>
    getEntitlements(orgId, createAdminClient(), now),
);

/** "Bookings made this month": original bookings (rescheduled_from_id null),
    any status, created inside the org-local calendar month. */
export async function monthlyBookingUsage(
  orgId: string, timeZone: string, now: Date, db: SupabaseClient,
): Promise<number> {
  const { fromIso, toIso } = monthWindow(now, timeZone);
  const { count, error } = await db
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .is("rescheduled_from_id", null)
    .gte("created_at", fromIso)
    .lt("created_at", toIso);
  if (error) throw error;
  return count ?? 0;
}

/** For client-facing emails: the badge URL to show unless the org hid it AND
    may (returns null then). Swallows errors (resolveClientStaffName idiom)
    — after a committed booking nothing may fail the action; showing the
    badge is the safe default. Returns a URL, not a boolean, so email
    templates stay pure (they take `badgeUrl: string | null`, never import
    env themselves).

    While BILLING_ENABLED is false, hiding is allowed unconditionally — the
    same answer the public pages get from loadPublicOffering's UNLIMITED
    entitlements. Without that check the flag-off world would read Free
    (hideBadge: false) and badge the emails of an org whose own booking page
    honours its "Hide" tick: one product, two answers. */
export async function emailBadgeUrl(orgId: string): Promise<string | null> {
  const url = `${env.NEXT_PUBLIC_APP_URL}/?ref=badge`;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from("orgs").select("widget_theme").eq("id", orgId).maybeSingle();
    if (error) throw error;
    const hideAllowed = BILLING_ENABLED ? (await getEntitlementsAdmin(orgId)).hideBadge : true;
    return badgeShows(parseWidgetTheme(data?.widget_theme).hidePoweredBy, hideAllowed) ? url : null;
  } catch (error) {
    console.error("[billing] emailBadgeUrl:", error);
    return url;
  }
}
