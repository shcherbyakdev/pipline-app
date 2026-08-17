"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAllowedLogoType, matchesLogoMagicBytes, logoPathFor, LOGO_MAX_BYTES } from "@/lib/storage/logo";
import { uploadBrandingObject, deleteBrandingObject } from "@/lib/storage/branding";
import { effectiveContrast } from "@/lib/widget-theme";
import {
  createOrgSchema,
  updateAccentInput,
  widgetThemeInput,
  GENERIC_WRITE_ERROR,
  type OrgState,
  type ActionState,
} from "./schema";

const CONTRAST_BLOCK = "Text and background contrast is below 3:1 — pick more distinct colours.";

export async function createOrg(
  _prev: OrgState,
  formData: FormData,
): Promise<OrgState> {
  const parsed = createOrgSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: "Organization name must be 2–80 characters." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.rpc("create_org", { p_name: parsed.data.name });
  if (error) return { error: error.message };

  redirect("/bookings");
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

function brandingFail(context: string, error: unknown): { ok: false; error: string } {
  console.error(`[orgs] ${context}:`, error);
  return { ok: false, error: GENERIC_WRITE_ERROR };
}

// update_org_branding has FULL-STATE semantics: every call passes both
// values, so each action threads the current value of the field it is NOT
// changing.
export async function updateAccent(input: unknown): Promise<ActionState> {
  const parsed = updateAccentInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
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

export async function updateWidgetTheme(input: unknown): Promise<ActionState> {
  const parsed = widgetThemeInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const cfg = parsed.data;
  // Server-side contrast floor (mirrors the form's block threshold).
  // effectiveContrast fills in whichever side (bg/text) isn't overridden
  // with that theme's default, so a lone override that collides with the
  // theme's default for the other side is still caught — not just pairs
  // where both are overridden.
  if (effectiveContrast(cfg) < 3) {
    return { ok: false, error: CONTRAST_BLOCK };
  }
  const { org, error: orgError } = await currentOrgBranding();
  if (!org) return brandingFail("updateWidgetTheme", orgError ?? "no org");
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_org_widget_theme", {
    p_org_id: org.id,
    p_theme: cfg,
  });
  if (error) return brandingFail("updateWidgetTheme", error);
  revalidatePath("/embed");
  revalidatePath("/bookings");
  return { ok: true };
}

export async function uploadLogo(formData: FormData): Promise<ActionState> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: GENERIC_WRITE_ERROR };
  if (file.size === 0 || file.size > LOGO_MAX_BYTES || !isAllowedLogoType(file.type)) {
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  const { org, error: orgError } = await currentOrgBranding();
  if (!org) return brandingFail("uploadLogo", orgError ?? "no org");

  const bytes = await file.arrayBuffer();
  // Re-check the buffered bytes, not just the File's reported size
  // (slice-8 photo precedent).
  if (bytes.byteLength === 0 || bytes.byteLength > LOGO_MAX_BYTES) {
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  // Sniff the buffered bytes against the declared MIME — isAllowedLogoType
  // above only checked the label, and `branding` is a public, directly-
  // navigable bucket, so a relabeled file (e.g. SVG as image/png) must be
  // caught here before it ever reaches storage.
  if (!matchesLogoMagicBytes(new Uint8Array(bytes), file.type)) {
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  const checksum = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
  const path = logoPathFor(org.id, checksum, file.type);
  if (!path) return { ok: false, error: GENERIC_WRITE_ERROR };

  if (!(await uploadBrandingObject(path, bytes, file.type))) {
    return { ok: false, error: GENERIC_WRITE_ERROR };
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
