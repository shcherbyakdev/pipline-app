import { type NextRequest, NextResponse } from "next/server";
import { requireOrg } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createGoogleClient } from "@/lib/google/calendar";
import { apiBase, googleConfigured, oauthConfig, redirectUri, supabaseConnectStore } from "@/features/calendar-sync/connections";
import { completeConnect, NONCE_COOKIE } from "@/features/calendar-sync/oauth-flow";
import { runCalendarSync } from "@/features/calendar-sync/run";

/* GET /api/google/callback?code=&state= — Google sends the person back
   here (spec 2026-09-05 §5). The signed state and the nonce cookie must
   agree and name the session that is signed in now; then the code becomes
   tokens, the calendar list is read, the row is inserted or refreshed, and
   the scope's upcoming bookings are pushed. Every failure lands on the
   page with a reason; nothing here is a 500. */

export async function GET(request: NextRequest) {
  if (!googleConfigured()) return new NextResponse(null, { status: 404 });
  const { user, org } = await requireOrg();
  const done = (q: string) => {
    const res = NextResponse.redirect(new URL(`/integrations?${q}`, request.url));
    res.cookies.set(NONCE_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/api/google", maxAge: 0 });
    return res;
  };

  const params = request.nextUrl.searchParams;
  // The person pressed Cancel on Google's screen.
  if (params.get("error")) return done("error=denied");

  const db = createAdminClient();
  const result = await completeConnect(
    {
      state: params.get("state"),
      code: params.get("code"),
      cookieNonce: request.cookies.get(NONCE_COOKIE)?.value,
      expected: { orgId: org.id, userId: user.id },
    },
    {
      cfg: oauthConfig(),
      redirectUri: redirectUri(),
      store: supabaseConnectStore(db),
      listCalendars: (accessToken) => createGoogleClient({ apiBase: apiBase(), getAccessToken: async () => accessToken }).listCalendars(),
    },
  );
  if (!result.ok) return done(`error=${result.reason}`);

  // The scope's upcoming bookings were just queued: push them now rather
  // than on the next tick, so the calendar fills in while the page loads.
  try {
    await runCalendarSync({ orgId: org.id }, db);
  } catch (error) {
    console.error("[calendar] first sync after connect failed:", error);
  }
  return done(result.reconnected ? "reconnected=1" : "connected=1");
}
