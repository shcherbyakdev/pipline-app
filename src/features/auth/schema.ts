import { z } from "zod";
import { HANDLE_RE, isReservedHandle } from "@/features/scheduling/handle";

export const emailSchema = z.object({
  email: z.string().email(),
});

// Sign-in validates presence only — the signup policy must not lock out
// accounts created before the 8-char minimum.
export const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Signup + reset enforce the policy: length over composition rules (NIST).
// Mirrors minimum_password_length = 8 in supabase/config.toml.
// `handle` is the landing page's claim (spec 2026-08-23-landing-claim): it
// rides as user metadata and only pre-fills onboarding, which re-validates.
//
// Issue messages are message keys under `auth` (spec §5: translate at the
// boundary — the action resolves them with t()). Never English here.
export const signUpSchema = z.object({
  email: z.string().email("errors.emailInvalid"),
  password: z.string().min(8, "errors.passwordMin"),
  handle: z.preprocess(
    // FormData.get() returns null for a field that was never submitted
    // (rather than undefined), and the field may be empty when present.
    (v) => (v == null || (typeof v === "string" && v.trim() === "") ? undefined : v),
    z
      .string()
      .regex(HANDLE_RE, "errors.handleInvalid")
      .refine((h) => !isReservedHandle(h), "errors.handleUnavailable")
      .optional(),
  ),
});

export const newPasswordSchema = z
  .object({
    password: z.string().min(8, "errors.passwordMin"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "errors.passwordsMismatch",
    path: ["confirm"],
  });

export type AuthState = { error?: string; sent?: boolean };
