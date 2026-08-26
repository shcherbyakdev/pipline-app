"use server";

import { cookies } from "next/headers";
import { env } from "@/env";
import { getCurrentOrg } from "@/lib/auth/session";
import { SETUP_DISMISSED_COOKIE, SETUP_DISMISSED_MAX_AGE } from "./setup-checklist";

// Dismiss the welcome banner for this browser. A cookie, not a column (see
// SETUP_DISMISSED_COOKIE): the banner hides itself once setup is done, so
// the only thing worth remembering is "stop showing me the chips", and
// losing that on another device costs a banner that is already on its way
// out. Setting a cookie in a server function re-renders the current page
// (Next: cookies() in server functions), so the caller needs no refresh.
export async function dismissWelcome(): Promise<void> {
  const org = await getCurrentOrg();
  if (!org) return;
  const jar = await cookies();
  jar.set(SETUP_DISMISSED_COOKIE, org.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NEXT_PUBLIC_APP_URL.startsWith("https://"),
    path: "/",
    maxAge: SETUP_DISMISSED_MAX_AGE,
  });
}
