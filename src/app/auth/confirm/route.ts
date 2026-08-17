import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next");
  const nextUrl = new URL(nextParam ?? "/bookings", request.url);
  const next =
    nextUrl.origin === new URL(request.url).origin
      ? nextUrl.pathname + nextUrl.search
      : "/bookings";

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      return NextResponse.redirect(new URL(next, request.url));
    }
  } else if (code) {
    // Default/hosted email templates use the PKCE ConfirmationURL flow:
    // GoTrue verifies the token at /auth/v1/verify and 303s here with
    // ?code=. Exchange it for a session so the emailed link works
    // regardless of which template flavor built it (our custom templates
    // link straight here with token_hash instead). The exchange needs the
    // code-verifier cookie set when the flow started, so a link opened in
    // a different browser still lands on the error path below.
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  return NextResponse.redirect(new URL("/login?error=auth", request.url));
}
