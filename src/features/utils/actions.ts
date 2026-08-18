"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireInternal } from "./guard";
import { grantOverrideInput, orgIdInput, revokeOverrideInput, setFlagInput } from "./schema";

/* The owner's writes (spec §3.4). Every action re-runs requireInternal — a
   server action is a POST endpoint of its own. Admin client throughout: these
   two tables have no member write policy on purpose. Not wrapped in
   try/catch: redirect() must escape, and a DB failure on an internal page
   is best shown as the stack trace it is. */

const SUBS_PATH = "/utils/subscriptions";

/** `org: null` omits `?org=` entirely — used on a validation failure where
    the submitted value isn't even a UUID, so it must never be echoed into a
    URL that readOrgAdminView's page will feed straight to Postgres. */
function subsUrl(org: string | null, extra: Record<string, string>): string {
  const params = new URLSearchParams(extra);
  if (org) params.set("org", org);
  return `${SUBS_PATH}?${params}`;
}

/** The submitted org id, but only if it's a well-formed UUID — otherwise
    null. Used on a safeParse failure to decide whether the redirect can
    still point at that org's panel or has to fall back to the picker. */
function safeOrgId(orgRaw: string): string | null {
  return orgIdInput.safeParse({ org: orgRaw }).success ? orgRaw : null;
}

/** YYYY-MM-DD → the last instant of that day, UTC. A comp "until the 31st"
    should still be on for the whole 31st. */
function endOfDayUtc(date: string): string {
  return new Date(`${date}T23:59:59.999Z`).toISOString();
}

export async function grantPlanOverride(formData: FormData): Promise<void> {
  const { user } = await requireInternal();
  const orgRaw = String(formData.get("org") ?? "");
  const parsed = grantOverrideInput.safeParse({
    org: orgRaw,
    plan: formData.get("plan"),
    expires: formData.get("expires") ?? "",
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) redirect(subsUrl(safeOrgId(orgRaw), { error: "invalid" }));
  const { org, plan, expires, note } = parsed.data;
  const admin = createAdminClient();
  const { error } = await admin.from("org_plan_overrides").upsert(
    {
      org_id: org,
      plan,
      expires_at: expires ? endOfDayUtc(expires) : null,
      note: note || null,
      granted_by: user.email ?? user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id" },
  );
  if (error) throw error;
  revalidatePath(SUBS_PATH);
  revalidatePath("/billing");
  redirect(subsUrl(org, { done: "granted" }));
}

export async function revokePlanOverride(formData: FormData): Promise<void> {
  await requireInternal();
  const orgRaw = String(formData.get("org") ?? "");
  const parsed = revokeOverrideInput.safeParse({ org: orgRaw });
  if (!parsed.success) redirect(subsUrl(safeOrgId(orgRaw), { error: "invalid" }));
  const admin = createAdminClient();
  const { error } = await admin.from("org_plan_overrides").delete().eq("org_id", parsed.data.org);
  if (error) throw error;
  revalidatePath(SUBS_PATH);
  revalidatePath("/billing");
  redirect(subsUrl(parsed.data.org, { done: "revoked" }));
}

const FLAGS_PATH = "/utils/flags";

/** `org: null` omits `?org=` entirely — see subsUrl's matching comment. */
function flagsUrl(org: string | null, extra: Record<string, string>): string {
  const params = new URLSearchParams(extra);
  if (org) params.set("org", org);
  return `${FLAGS_PATH}?${params}`;
}

export async function setOrgFlag(formData: FormData): Promise<void> {
  const { user } = await requireInternal();
  const orgRaw = String(formData.get("org") ?? "");
  const parsed = setFlagInput.safeParse({ org: orgRaw, flag: formData.get("flag"), value: formData.get("value") });
  if (!parsed.success) redirect(flagsUrl(safeOrgId(orgRaw), { error: "invalid" }));
  const { org, flag, value } = parsed.data;
  const admin = createAdminClient();
  if (value === "default") {
    const { error } = await admin.from("org_feature_flags").delete().eq("org_id", org).eq("flag", flag);
    if (error) throw error;
  } else {
    const { error } = await admin.from("org_feature_flags").upsert(
      { org_id: org, flag, enabled: value === "on", updated_by: user.email ?? user.id, updated_at: new Date().toISOString() },
      { onConflict: "org_id,flag" },
    );
    if (error) throw error;
  }
  // The dashboard reads flags on every render; the whole layout is stale.
  revalidatePath("/", "layout");
  redirect(flagsUrl(org, { done: "flag_set" }));
}
