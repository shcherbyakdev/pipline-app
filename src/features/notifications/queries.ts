import "server-only";

import { createClient } from "@/lib/supabase/server";
import { requireOrg } from "@/lib/auth/session";
import { parseMemberPrefs, parseOrgPrefs, type MemberPrefs, type OrgPrefs } from "./prefs";

export type PushDevice = { id: string; endpoint: string; userAgent: string | null; createdAt: string };

export type NotificationSettings = {
  orgId: string;
  userId: string;
  member: MemberPrefs;
  org: OrgPrefs;
  /** This person's enabled browsers (RLS: own rows only). */
  devices: PushDevice[];
};

/** Everything /notifications shows, in three reads through the member's
    own client (orgs and org_members are readable, push_subscriptions is
    own-rows). Null columns come back as the defaults. */
export async function getNotificationSettings(): Promise<NotificationSettings> {
  const { user, org } = await requireOrg();
  const supabase = await createClient();
  const [member, orgRow, devices] = await Promise.all([
    supabase.from("org_members").select("notification_prefs").eq("org_id", org.id).eq("user_id", user.id).maybeSingle(),
    supabase.from("orgs").select("notification_prefs").eq("id", org.id).maybeSingle(),
    supabase
      .from("push_subscriptions")
      .select("id, endpoint, user_agent, created_at")
      .eq("org_id", org.id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
  ]);
  if (member.error) throw member.error;
  if (orgRow.error) throw orgRow.error;
  if (devices.error) throw devices.error;
  return {
    orgId: org.id,
    userId: user.id,
    member: parseMemberPrefs(member.data?.notification_prefs),
    org: parseOrgPrefs(orgRow.data?.notification_prefs),
    devices: (devices.data ?? []).map((d) => ({ id: d.id, endpoint: d.endpoint, userAgent: d.user_agent, createdAt: d.created_at })),
  };
}
