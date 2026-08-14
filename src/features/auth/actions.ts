"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/env";
import {
  emailSchema,
  signInSchema,
  signUpSchema,
  newPasswordSchema,
  type AuthState,
} from "./schema";

export async function sendMagicLink(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = emailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { error: "Enter a valid email address." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/confirm` },
  });

  if (error) return { error: "Could not send the link. Try again shortly." };
  return { sent: true };
}

export async function signInWithPassword(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "Enter a valid email and password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  // Generic on purpose: raw Supabase messages distinguish unknown accounts
  // from unconfirmed ones, which leaks account existence.
  if (error) return { error: "Invalid email or password." };
  redirect("/programs");
}

export async function signUp(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ?? "Enter a valid email and password.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/confirm` },
  });

  if (error) return { error: "Could not create your account. Try again." };
  // Existing emails get an obfuscated user (no error) from Supabase when
  // confirmations are on, so this copy never reveals account existence.
  return { sent: true };
}

export async function requestPasswordReset(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = emailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { error: "Enter a valid email address." };

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
  const parsed = newPasswordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Enter a valid password.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) {
    return { error: "Could not update your password. Request a new reset link." };
  }
  redirect("/programs");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
