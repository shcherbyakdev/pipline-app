import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/env";
import { isProtectedPath } from "@/lib/auth/next-path";
import { isLocale } from "@/i18n/config";
import { LOCALE_COOKIE, LOCALE_COOKIE_OPTIONS } from "@/i18n/cookie";

// Refreshes the Supabase auth session on every request and keeps the
// session cookie in sync between the request and the response. Also the
// one place an anonymous request to a protected path is turned away
// (audit 2026-08-24): the (dashboard) layout's guard only runs on a full
// render, so after a sign-out in another tab a soft navigation used to
// render the next page empty instead of bouncing to /login.
export async function updateSession(request: NextRequest) {
  // Stamped for requireUser(): where to come back to after logging in.
  const path = request.nextUrl.pathname + request.nextUrl.search;
  request.headers.set("x-pathname", path);

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: do not run code between createServerClient and getUser().
  // getUser() revalidates the token and triggers the cookie refresh above.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Interface locale (spec §8): a signed-in person whose browser has no
  // NEXT_LOCALE yet gets it from user_metadata, so a choice made on one
  // device holds on the next. Same request/response dance as setAll above,
  // so the seeded cookie reaches this request's server components too.
  const saved = user?.user_metadata?.locale;
  if (isLocale(saved) && !request.cookies.has(LOCALE_COOKIE)) {
    request.cookies.set(LOCALE_COOKIE, saved);
    const seeded = NextResponse.next({ request });
    supabaseResponse.cookies.getAll().forEach((c) => seeded.cookies.set(c));
    seeded.cookies.set(LOCALE_COOKIE, saved, LOCALE_COOKIE_OPTIONS);
    supabaseResponse = seeded;
  }

  if (!user && isProtectedPath(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    // The reset page is only reachable through a recovery link; a bare
    // visit has nowhere sensible to return to.
    if (request.nextUrl.pathname !== "/reset-password") url.searchParams.set("next", path);
    const redirect = NextResponse.redirect(url);
    // Carry any refreshed cookies (the @supabase/ssr contract).
    supabaseResponse.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }

  return supabaseResponse;
}
