import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { RECOVERY_COOKIE, RECOVERY_COOKIE_MAX_AGE } from "@/lib/auth/next-path";

// The only `next` this app ever emits is the reset page (recovery template
// + requestPasswordReset). An allowlist, not an origin check: the previous
// `new URL(next, request.url).origin` comparison accepted
// `https://booklo.co//evil.com` — same origin, pathname "//evil.com", which
// the redirect then re-resolved as protocol-relative (audit 2026-08-24).
const RESET = "/reset-password";
const DASHBOARD = "/bookings";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = searchParams.get("next") === RESET ? RESET : DASHBOARD;
  // A recovery verification (custom template: type=recovery; hosted PKCE
  // template: next=/reset-password) mints the proof updatePassword requires.
  const recovery = type === "recovery" || next === RESET;

  const supabase = await createClient();
  let verified = false;
  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    verified = !error;
  } else if (code) {
    // Default/hosted email templates use the PKCE ConfirmationURL flow:
    // GoTrue verifies the token at /auth/v1/verify and 303s here with
    // ?code=. Exchange it for a session so the emailed link works
    // regardless of which template flavor built it (our custom templates
    // link straight here with token_hash instead). The exchange needs the
    // code-verifier cookie set when the flow started, so a link opened in
    // a different browser still lands on the error path below.
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    verified = !error;
  }

  if (verified) {
    const res = NextResponse.redirect(new URL(next, request.url));
    if (recovery) {
      res.cookies.set(RECOVERY_COOKIE, "1", {
        httpOnly: true,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        path: "/",
        maxAge: RECOVERY_COOKIE_MAX_AGE,
      });
    }
    return res;
  }

  // A used link opened twice (or prefetched by a mail client) by someone
  // who is already signed in is not an error — send them on.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    return NextResponse.redirect(new URL(recovery ? "/forgot-password?expired=1" : DASHBOARD, request.url));
  }

  return NextResponse.redirect(new URL("/login?error=auth", request.url));
}
