import { z } from "zod";

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
export const signUpSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export const newPasswordSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Passwords don't match.",
    path: ["confirm"],
  });

export type AuthState = { error?: string; sent?: boolean };
