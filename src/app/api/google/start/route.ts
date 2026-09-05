import { type NextRequest, NextResponse } from "next/server";
import { requireOrg } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { perkToggle } from "@/lib/billing/badge-toggle";
import { googleConfigured, oauthConfig, redirectUri } from "@/features/calendar-sync/connections";
import { beginConnect, NONCE_COOKIE, NONCE_MAX_AGE } from "@/features/calendar-sync/oauth-flow";

/* GET /api/google/start[?staff=<id>] — the Connect button (spec 2026-09-05
   §5). Session + org, the Pro perk, then a 302 to Google's consent page
   with a signed state; the nonce inside it is mirrored in an httpOnly
   cookie the callback compares against (CSRF on the callback). */

export async function GET(request: NextRequest) {
  if (!googleConfigured()) return new NextResponse(null, { status: 404 });
  const { user, org } = await requireOrg();
  const back = (q: string) => NextResponse.redirect(new URL(`/integrations?${q}`, request.url));

  const { allowed } = await perkToggle(org.id, (ent) => ent.gcalSync);
  if (!allowed) return back("error=plan");

  // "Connect for <person>": the staff id must be one of the org's own.
  let staffId: string | null = null;
  const requested = request.nextUrl.searchParams.get("staff");
  if (requested) {
    const { data } = await createAdminClient().from("staff").select("id").eq("id", requested).eq("org_id", org.id).maybeSingle();
    if (!data) return back("error=state");
    staffId = data.id;
  }

  const { url, nonce } = beginConnect({ orgId: org.id, userId: user.id, staffId }, oauthConfig(), redirectUri());
  const res = NextResponse.redirect(url);
  res.cookies.set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/api/google",
    maxAge: NONCE_MAX_AGE,
  });
  return res;
}
