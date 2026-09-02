"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { afterLogin, RECOVERY_COOKIE } from "@/lib/auth/next-path";
import { env } from "@/env";
import {
  emailSchema,
  signInSchema,
  signUpSchema,
  newPasswordSchema,
  type AuthState,
} from "./schema";
import type en from "../../../messages/en.json";

type AuthT = Awaited<ReturnType<typeof getTranslations<"auth">>>;
type AuthErrorKey = `errors.${keyof (typeof en)["auth"]["errors"]}`;

// Zod issue messages are keys (schema.ts) — but only ones we wrote: a schema
// gap can also leave zod's own default message ("Invalid input: expected
// string, received null") in `issue.message`, which is not a key at all. The
// `errors.` prefix check keeps that default from ever being handed to t();
// t.has() is the runtime check that it is one of ours; the cast is the one
// place a checked string meets the typed t.
function issueMessage(t: AuthT, issue: { message: string } | undefined, fallback: AuthErrorKey): string {
  const key = issue?.message;
  return key && key.startsWith("errors.") && t.has(key as AuthErrorKey) ? t(key as AuthErrorKey) : t(fallback);
}

export async function sendMagicLink(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const t = await getTranslations("auth");
  const parsed = emailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { error: t("errors.emailInvalid") };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/confirm` },
  });

  if (error) return { error: t("errors.linkFailed") };
  return { sent: true };
}

export async function signInWithPassword(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const t = await getTranslations("auth");
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: t("errors.credentialsInvalid") };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  // Generic on purpose: raw Supabase messages distinguish unknown accounts
  // from unconfirmed ones, which leaks account existence.
  if (error) return { error: t("errors.signInFailed") };
  // Back to the page the session expired on (requireUser / the proxy set
  // it); afterLogin refuses anything that is not a same-site path.
  redirect(afterLogin(formData.get("next")));
}

export async function signUp(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const t = await getTranslations("auth");
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    handle: formData.get("handle"),
  });
  if (!parsed.success) {
    return { error: issueMessage(t, parsed.error.issues[0], "errors.credentialsInvalid") };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/confirm`,
      data: {
        // Interface locale (spec §8): the proxy seeds a new device from it.
        locale: await getLocale(),
        // Advisory only: onboarding pre-fills from it and re-checks availability.
        ...(parsed.data.handle ? { claimed_handle: parsed.data.handle } : {}),
      },
    },
  });

  if (error) {
    // Two codes are worth their own copy and reveal nothing about accounts:
    // a rejected password (HIBP leaked-password protection at launch) and
    // the auth rate limit. Everything else stays generic.
    if (error.code === "weak_password") {
      return { error: t("errors.passwordWeak") };
    }
    if (error.code === "over_request_rate_limit" || error.code === "over_email_send_rate_limit") {
      return { error: t("errors.tooManyAttempts") };
    }
    return { error: t("errors.signUpFailed") };
  }
  // Existing emails get an obfuscated user (no error) from Supabase when
  // confirmations are on, so this copy never reveals account existence.
  return { sent: true };
}

export async function requestPasswordReset(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const t = await getTranslations("auth");
  const parsed = emailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { error: t("errors.emailInvalid") };

  const supabase = await createClient();
  // The recovery template hardcodes next=/reset-password; redirectTo only
  // feeds {{ .RedirectTo }}, kept for hosted-template parity.
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/confirm?next=/reset-password`,
  });

  // Server-side trace only — the client response must stay identical either way.
  if (error) console.error("requestPasswordReset failed:", error.message);

  // Always report success — errors here would reveal account existence.
  return { sent: true };
}

export async function updatePassword(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const t = await getTranslations("auth");
  const parsed = newPasswordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { error: issueMessage(t, parsed.error.issues[0], "errors.passwordInvalid") };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Only a session minted by a recovery link may set a password without
  // knowing the old one (audit 2026-08-24: any live session could, so an
  // unattended tab was a full takeover). /auth/confirm sets the proof for
  // 15 minutes; it is spent here.
  const jar = await cookies();
  if (!jar.get(RECOVERY_COOKIE)) {
    return { error: t("errors.resetExpired") };
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) {
    return { error: t("errors.updateFailed") };
  }
  jar.delete(RECOVERY_COOKIE);
  redirect("/bookings");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
