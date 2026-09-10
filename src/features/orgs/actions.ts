"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAllowedLogoType, matchesLogoMagicBytes, logoPathFor, LOGO_MAX_BYTES } from "@/lib/storage/logo";
import { uploadBrandingObject, deleteBrandingObject } from "@/lib/storage/branding";
import { effectiveContrast } from "@/lib/widget-theme";
import { getCurrentOrg } from "@/lib/auth/session";
import { seedDefaultHours } from "@/features/scheduling/default-hours";
import { stepHref } from "./onboarding-steps";
import { isRpcSentinel } from "@/lib/rpc-sentinel";
import {
  createOrgWithPageSchema,
  updateAccentInput,
  updateOrgModesInput,
  updateOrgClientContactInput,
  modeToFlags,
  surfaceThemeInput,
  type OrgState,
  type ActionState,
} from "./schema";

// One-step onboarding: org + handle + timezone via create_org_with_page (0051).
// A handle race surfaces as 23505 → specific copy, everything else generic.
// (The pre-0051 two-step createOrg action was deleted in the 2026-08-24
// audit: no caller, and it returned raw Postgres messages to the client.)
export async function createOrgWithPage(
  _prev: OrgState,
  formData: FormData,
): Promise<OrgState> {
  const parsed = createOrgWithPageSchema.safeParse({
    name: formData.get("name"),
    handle: formData.get("handle"),
    timezone: formData.get("timezone"),
  });
  const t = await getTranslations("errors");
  if (!parsed.success) return { error: t("orgs.invalidInput") };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  // A double submit (two tabs, a retried POST) must not mint a second org;
  // the RPC refuses too (0052), this just skips the round trip.
  if (await getCurrentOrg()) redirect("/bookings");

  // Appointments by default; the wizard's mode step flips it via
  // update_org_modes for spaces sellers. (A later flip to spaces-only
  // keeps the hours seeded below — invisible until appointments return,
  // pre-filled if they do.)
  const { data: org, error } = await supabase.rpc("create_org_with_page", {
    p_name: parsed.data.name,
    p_handle: parsed.data.handle,
    p_timezone: parsed.data.timezone,
    p_offers_appointments: true,
    p_offers_rentals: false,
    // The org speaks its creator's language until the Booking page Settings
    // tab says otherwise (i18n spec §8).
    p_locale: await getLocale(),
  });
  if (error) {
    if (error.code === "23505") return { error: t("orgs.handleJustTaken") };
    if (isRpcSentinel(error, "already onboarded")) redirect("/bookings");
    if (isRpcSentinel(error, "invalid timezone")) return { error: t("orgs.timezoneUnknown") };
    console.error("[orgs] create_org_with_page:", error.message);
    return { error: t("generic") };
  }
  // A new account is bookable on day one. create_org mints the first team
  // member; this gives them the default week so /availability does not open
  // on seven "Unavailable" days (features/scheduling/default-hours.ts).
  // Spaces-only orgs are skipped on purpose: their staff row is not bookable
  // and never surfaces on /availability, so hours there would be invisible
  // ones that still tick the setup checklist's "Set hours" chip — the
  // honest-tick rule. Onboarding never fails over this: the org exists
  // either way and the editor offers the same week in one click.
  await seedFirstMemberHours(supabase, org);
  // Straight into the wizard (mode first — appointments preselected). Every
  // step is skippable; the welcome banner still shows itself on /bookings
  // until setup is done (setup-checklist.ts showWelcome).
  redirect(stepHref("mode"));
}

// create_org_with_page returns the org row; the staff row it mints is read
// back rather than guessed. Every failure here is logged and swallowed —
// see the call site.
async function seedFirstMemberHours(
  supabase: Awaited<ReturnType<typeof createClient>>,
  org: unknown,
): Promise<void> {
  const orgId = (org as { id?: unknown } | null)?.id;
  if (typeof orgId !== "string") {
    console.error("[orgs] seedFirstMemberHours: create_org_with_page returned no org row");
    return;
  }
  const { data, error } = await supabase
    .from("staff")
    .select("id")
    .eq("org_id", orgId)
    .limit(1)
    .maybeSingle();
  if (error || typeof data?.id !== "string") {
    console.error("[orgs] seedFirstMemberHours: no staff row for", orgId, error?.message ?? "");
    return;
  }
  const seedError = await seedDefaultHours(supabase, orgId, { staffId: data.id });
  if (seedError) console.error("[orgs] seedFirstMemberHours:", seedError.message);
}

type OrgBrandingRow = { id: string; accent_color: string | null; logo_path: string | null };

// Propagates the read error (rather than discarding it) so callers can log
// a transient failure distinctly from a genuinely missing org — the
// queries.ts/session.ts siblings propagate the same way.
async function currentOrgBranding(): Promise<{ org: OrgBrandingRow | null; error: unknown }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orgs")
    .select("id, accent_color, logo_path")
    .limit(1)
    .maybeSingle();
  return { org: data ?? null, error };
}

async function brandingFail(context: string, error: unknown): Promise<{ ok: false; error: string }> {
  console.error(`[orgs] ${context}:`, error);
  return fail();
}

/** The generic refusal in the admin's language (i18n Wave 3). */
async function fail(): Promise<{ ok: false; error: string }> {
  return { ok: false, error: (await getTranslations("errors"))("generic") };
}

// update_org_branding has FULL-STATE semantics: every call passes both
// values, so each action threads the current value of the field it is NOT
// changing.
export async function updateAccent(input: unknown): Promise<ActionState> {
  const parsed = updateAccentInput.safeParse(input);
  if (!parsed.success) return fail();
  const { org, error: orgError } = await currentOrgBranding();
  if (!org) return brandingFail("updateAccent", orgError ?? "no org");
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_org_branding", {
    p_org_id: org.id,
    p_accent_color: parsed.data.accentColor,
    p_logo_path: org.logo_path,
  });
  if (error) return brandingFail("updateAccent", error);
  revalidatePath("/booking-page");
  revalidatePath("/embed");
  return { ok: true };
}

/** One appearance per surface (spec 2026-09-02 §9): `page` is the hosted
    booking page, `embed` the widget on the org's own site. */
export async function updateSurfaceTheme(input: unknown): Promise<ActionState> {
  const parsed = surfaceThemeInput.safeParse(input);
  if (!parsed.success) return fail();
  const { surface, theme: cfg } = parsed.data;
  // Server-side contrast floor (mirrors the form's block threshold).
  // effectiveContrast fills in whichever side (bg/text) isn't overridden
  // with that theme's default, so a lone override that collides with the
  // theme's default for the other side is still caught — not just pairs
  // where both are overridden.
  if (effectiveContrast(cfg) < 3) {
    const t = await getTranslations("errors");
    return { ok: false, error: t("orgs.contrast") };
  }
  const { org, error: orgError } = await currentOrgBranding();
  if (!org) return brandingFail("updateSurfaceTheme", orgError ?? "no org");
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_org_surface_theme", {
    p_org_id: org.id,
    p_surface: surface,
    p_theme: cfg,
  });
  if (error) return brandingFail("updateSurfaceTheme", error);
  revalidatePath(surface === "embed" ? "/embed" : "/booking-page");
  revalidatePath("/bookings");
  return { ok: true };
}

export async function uploadLogo(formData: FormData): Promise<ActionState> {
  const file = formData.get("file");
  if (!(file instanceof File)) return fail();
  if (file.size === 0 || file.size > LOGO_MAX_BYTES || !isAllowedLogoType(file.type)) {
    return fail();
  }
  const { org, error: orgError } = await currentOrgBranding();
  if (!org) return brandingFail("uploadLogo", orgError ?? "no org");

  const bytes = await file.arrayBuffer();
  // Re-check the buffered bytes, not just the File's reported size
  // (slice-8 photo precedent).
  if (bytes.byteLength === 0 || bytes.byteLength > LOGO_MAX_BYTES) {
    return fail();
  }
  // Sniff the buffered bytes against the declared MIME — isAllowedLogoType
  // above only checked the label, and `branding` is a public, directly-
  // navigable bucket, so a relabeled file (e.g. SVG as image/png) must be
  // caught here before it ever reaches storage.
  if (!matchesLogoMagicBytes(new Uint8Array(bytes), file.type)) {
    return fail();
  }
  const checksum = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
  const path = logoPathFor(org.id, checksum, file.type);
  if (!path) return fail();

  if (!(await uploadBrandingObject(path, bytes, file.type))) {
    return fail();
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_org_branding", {
    p_org_id: org.id,
    p_accent_color: org.accent_color,
    p_logo_path: path,
  });
  if (error) {
    // Only compensate on a DEFINITE rejection (non-empty error.code); a
    // transport failure is indeterminate and must leave the object — the
    // slice-8 asymmetric-compensation lesson (see flow-actions.ts's
    // uploadPhoto for the full reasoning).
    if (error.code) await deleteBrandingObject(path);
    return brandingFail("uploadLogo", error);
  }
  // DB update landed: the old object (different content hash) is now
  // unreferenced — delete it best-effort.
  if (org.logo_path && org.logo_path !== path) await deleteBrandingObject(org.logo_path);
  revalidatePath("/booking-page");
  return { ok: true };
}

export async function removeLogo(): Promise<ActionState> {
  const { org, error: orgError } = await currentOrgBranding();
  if (!org) return brandingFail("removeLogo", orgError ?? "no org");
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_org_branding", {
    p_org_id: org.id,
    p_accent_color: org.accent_color,
    p_logo_path: null,
  });
  if (error) return brandingFail("removeLogo", error);
  if (org.logo_path) await deleteBrandingObject(org.logo_path);
  revalidatePath("/booking-page");
  return { ok: true };
}

export async function updateOrgModes(input: unknown): Promise<ActionState> {
  const parsed = updateOrgModesInput.safeParse(input);
  if (!parsed.success) return fail();
  const { org, error: orgError } = await currentOrgBranding();
  if (!org) return brandingFail("updateOrgModes", orgError ?? "no org");
  const supabase = await createClient();
  const flags = modeToFlags(parsed.data.mode);
  const { error } = await supabase.rpc("update_org_modes", {
    p_org_id: org.id,
    p_offers_appointments: flags.offersAppointments,
    p_offers_rentals: flags.offersRentals,
  });
  if (error) {
    // The RPC's defence for the Settings lock: the current channel still has
    // active rows (a wizard revisit, a stale tab).
    if (error.message.includes("channel_in_use")) return { ok: false, error: (await getTranslations("errors"))("orgs.channelInUse") };
    return brandingFail("updateOrgModes", error);
  }
  // The sidebar/command menu read the flags in the dashboard layout.
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateOrgClientContact(input: unknown): Promise<ActionState> {
  const parsed = updateOrgClientContactInput.safeParse(input);
  if (!parsed.success) return fail();
  const { org, error: orgError } = await currentOrgBranding();
  if (!org) return brandingFail("updateOrgClientContact", orgError ?? "no org");
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_org_client_contact", {
    p_org_id: org.id,
    p_value: parsed.data.value,
  });
  if (error) return brandingFail("updateOrgClientContact", error);
  revalidatePath("/settings");
  return { ok: true };
}
