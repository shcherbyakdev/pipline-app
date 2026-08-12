# Email + Password Auth with Reset Flow — Design

**Date:** 2026-08-12
**Status:** Approved
**Approach:** Extend the existing server-action auth pattern (approach A). No browser Supabase client, no third-party auth UI.

## Context

Login today is magic-link only: `sendMagicLink` → `signInWithOtp` → email → `/auth/confirm` verifies `token_hash` and redirects. `enable_signup = true`, so a magic link both creates and signs in users. Post-auth, `/onboarding` provisions the org (unchanged by this work).

This slice adds email + password as the primary login method, a password signup page, and an email-based password reset flow. Magic link stays as a secondary login option. No in-app "change password" settings UI in v1 — the reset flow covers set/change/forgot.

## Routes & UI

All new pages live in the `(auth)` route group beside `/login`, reusing its card layout, `Button`/`Input`/`Label` components, and `useActionState` form pattern.

- **`/login`** — password form becomes primary: email, password, "Forgot password?" link, submit. Below a divider, a "Email me a magic link instead" toggle swaps the password form for the existing magic-link form (client-side state, one page). Footer links to `/signup`.
- **`/signup`** — email + password. On success, always renders "Check your email to confirm your account." Supabase returns an obfuscated user for already-registered emails when confirmations are enabled, so the UI never reveals whether an account exists.
- **`/forgot-password`** — email only. Always renders "If an account exists for that address, you'll receive a password reset link." Rendered on success *and* on user-not-found errors.
- **`/reset-password`** — new password + confirm field. Requires an authenticated session (the recovery link signs the user in via `/auth/confirm`); unauthenticated visitors are redirected to `/login`. On success, redirects to `/programs`.

## Server actions

Extend `src/features/auth/actions.ts`; each action follows the existing `(prev: AuthState, formData) => AuthState` shape used with `useActionState`.

- **`signInWithPassword`** — zod-validate email + password; call `supabase.auth.signInWithPassword`. On any auth failure return the generic "Invalid email or password." (never the raw Supabase message, which can distinguish unconfirmed/unknown accounts). On success `redirect("/programs")`.
- **`signUp`** — zod-validate; call `supabase.auth.signUp` with `emailRedirectTo: ${NEXT_PUBLIC_APP_URL}/auth/confirm`. Return `{ sent: true }`.
- **`requestPasswordReset`** — validate email; call `supabase.auth.resetPasswordForEmail(email, { redirectTo: ${NEXT_PUBLIC_APP_URL}/auth/confirm?next=/reset-password })`. Always return `{ sent: true }`, including on error, to prevent enumeration. (Supabase's own behavior already hides existence; this hardens the action against transport-level differences.)
- **`updatePassword`** — require a session (reuse `requireUser()` from `src/lib/auth/session.ts`); validate new password + confirmation match; call `supabase.auth.updateUser({ password })`; `redirect("/programs")`.

### Schema additions (`src/features/auth/schema.ts`)

- `passwordSchema`: email + password (password `z.string().min(8)` — length over composition rules, per NIST; no complexity requirements).
- `newPasswordSchema`: password min 8 + confirm; the match check returns a field-level error ("Passwords don't match").
- `AuthState` unchanged (`{ error?, sent? }`).

## Confirm route

`/auth/confirm/route.ts` already verifies any `EmailOtpType` via `verifyOtp({ type, token_hash })` and honors a same-origin `next` param. Recovery links carry `next=/reset-password`; signup confirmations default to `/programs`. **No changes needed** except that its failure redirect (`/login?error=auth`) gets rendered as a friendly message on the login page ("That link is invalid or has expired — request a new one.").

## Supabase config & email templates

`supabase/config.toml`:

- `minimum_password_length`: 6 → **8**.
- `[auth.email] enable_confirmations`: false → **true** (password signups must verify their email before signing in).

New templates in `supabase/templates/`, matching `magic_link.html`'s structure (link → `/auth/confirm?token_hash={{ .TokenHash }}&type=<type>&next=<dest>`):

- `confirmation.html` — signup confirmation, `type=email` (matches `magic_link.html`'s convention and current Supabase docs), no `next` param so the confirm route's `/programs` default applies.
- `recovery.html` — password reset, `type=recovery`, `next=/reset-password`.

Wired in `config.toml` as `[auth.email.template.confirmation]` and `[auth.email.template.recovery]`.

**Hosted-project note:** leaked-password protection (HaveIBeenPwned check) and these template customizations must be applied in the Supabase dashboard for the production project — they are not carried by local `config.toml`. Production email sending needs custom SMTP (default service is heavily rate-limited and, on newer free-tier projects, blocks template customization).

## Error handling & security posture

- Generic credential errors on login; enumeration-safe copy on signup and forgot-password (always "check your email").
- Rate limiting: rely on Supabase Auth's built-in rate limits (`[auth.rate_limit]`, `max_frequency`) — no app-level limiter for auth in v1.
- The recovery link creates a real session (standard Supabase SSR behavior); `/reset-password` is therefore a normal authenticated page. `secure_password_change` stays off — the recovery session is the authorization.
- All auth remains server-side through `@supabase/ssr` cookies; no `NEXT_PUBLIC_` secrets involved beyond the existing publishable key.

## Testing

- Vitest unit tests for the new zod schemas (valid/invalid/mismatch cases).
- Action tests with a mocked Supabase server client, matching the existing action-test pattern: error mapping to generic copy, `{ sent: true }` on reset regardless of Supabase error, redirect on successful login/update.
- Manual Mailpit walkthrough (local Supabase, Mailpit at `:54354`) documented in the implementation plan: signup → confirm → onboarding; forgot → recovery link → reset → login with new password; both login paths.

## Out of scope

- In-app change-password / account settings UI.
- OAuth/social providers, MFA, CAPTCHA.
- App-level rate limiting for auth endpoints.
- Deleting the magic-link path (it stays as secondary login).
