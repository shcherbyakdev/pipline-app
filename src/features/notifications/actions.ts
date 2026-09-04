"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { requireOrg } from "@/lib/auth/session";
import { emailTranslators } from "@/i18n/emails";
import { perkToggle } from "@/lib/billing/badge-toggle";
import {
  DEFAULT_REMINDER_LEAD_HOURS,
  MEMBER_EVENTS,
  parseMemberPrefs,
  setMemberChannel,
  type OrgPrefs,
} from "./prefs";
import { pushConfigured, sendPush } from "./push";

export type ActionResult = { ok: true } | { ok: false; error: string };

// Every refusal a person reads is the admin-language generic line
// (scheduling/actions.ts idiom); the cause is logged.
async function invalid(): Promise<ActionResult> {
  const t = await getTranslations("errors");
  return { ok: false, error: t("generic") };
}
async function fail(context: string, error: unknown): Promise<ActionResult> {
  console.error(`[notifications] ${context}:`, error);
  return invalid();
}

const memberPrefInput = z.object({
  event: z.enum(MEMBER_EVENTS),
  channel: z.enum(["email", "push"]),
  enabled: z.boolean(),
});

/** One switch on the "What you hear about" card. Reads the current row,
    flips one channel, writes the FULL object back (the RPC has full-state
    semantics), so two quick flips on different rows cannot clobber each
    other's default-filled fields. */
export async function setMemberPref(input: unknown): Promise<ActionResult> {
  const parsed = memberPrefInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { user, org } = await requireOrg();
  const supabase = await createClient();
  const { data: row, error: readError } = await supabase
    .from("org_members")
    .select("notification_prefs")
    .eq("org_id", org.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (readError) return fail("setMemberPref read", readError);
  const next = setMemberChannel(parseMemberPrefs(row?.notification_prefs), parsed.data.event, parsed.data.channel, parsed.data.enabled);
  const { error } = await supabase.rpc("update_member_notification_prefs", { p_org_id: org.id, p_prefs: next });
  if (error) return fail("setMemberPref", error);
  revalidatePath("/notifications");
  return { ok: true };
}

const reminderInput = z.object({
  enabled: z.boolean(),
  leadHours: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(6), z.literal(12), z.literal(24), z.literal(48)]),
});

/** The Reminders card. A lead other than the default is a paid perk: the
    page disables the picker, and this refuses the same way (the same
    perkToggle read), so a hand-crafted request cannot buy it. The drain
    enforces it a third time at send. */
export async function setReminderPrefs(input: unknown): Promise<ActionResult> {
  const parsed = reminderInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { org } = await requireOrg();
  if (parsed.data.leadHours !== DEFAULT_REMINDER_LEAD_HOURS) {
    const { allowed } = await perkToggle(org.id, (ent) => ent.customReminders);
    if (!allowed) return invalid();
  }
  const prefs: OrgPrefs = { reminder: { enabled: parsed.data.enabled, leadHours: parsed.data.leadHours } };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_org_notification_prefs", { p_org_id: org.id, p_prefs: prefs });
  if (error) return fail("setReminderPrefs", error);
  revalidatePath("/notifications");
  return { ok: true };
}

const subscriptionInput = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({ p256dh: z.string().min(1).max(512), auth: z.string().min(1).max(512) }),
  userAgent: z.string().max(512).optional(),
});

/** The browser handed us a PushSubscription; keep it. A browser that
    re-subscribes gets the same endpoint back, so an existing row for it is
    replaced (delete + insert — members have no UPDATE, 0075). */
export async function savePushSubscription(input: unknown): Promise<ActionResult> {
  const parsed = subscriptionInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { user, org } = await requireOrg();
  const supabase = await createClient();
  const { error: clearError } = await supabase.from("push_subscriptions").delete().eq("endpoint", parsed.data.endpoint);
  if (clearError) return fail("savePushSubscription clear", clearError);
  const { error } = await supabase.from("push_subscriptions").insert({
    user_id: user.id,
    org_id: org.id,
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
    user_agent: parsed.data.userAgent ?? null,
  });
  if (error) return fail("savePushSubscription", error);
  revalidatePath("/notifications");
  return { ok: true };
}

const removeInput = z.object({ id: z.string().uuid() });

export async function removePushSubscription(input: unknown): Promise<ActionResult> {
  const parsed = removeInput.safeParse(input);
  if (!parsed.success) return invalid();
  await requireOrg();
  const supabase = await createClient();
  // RLS: own rows only, so a foreign id is a silent no-op — reported as
  // "not found" rather than success.
  const { data, error } = await supabase.from("push_subscriptions").delete().eq("id", parsed.data.id).select("id");
  if (error) return fail("removePushSubscription", error);
  if (!data || data.length === 0) return invalid();
  revalidatePath("/notifications");
  return { ok: true };
}

/** "Send a test": proves the enabled devices actually ring. In the org's
    language like every other outbound text (D4). */
export async function sendTestPush(): Promise<ActionResult> {
  const { user, org } = await requireOrg();
  if (!pushConfigured()) return invalid();
  const supabase = await createClient();
  const { data } = await supabase.from("orgs").select("locale").eq("id", org.id).maybeSingle();
  const mail = await emailTranslators(data?.locale);
  const summary = await sendPush(user.id, {
    title: mail.t("push.test.title"),
    body: mail.t("push.test.body"),
    url: "/notifications",
    tag: `test:${Date.now()}`,
  });
  if (summary.sent === 0) return invalid();
  return { ok: true };
}
