"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isLocale, type Locale } from "./config";
import { LOCALE_COOKIE, LOCALE_COOKIE_OPTIONS } from "./cookie";

// The one write path for the interface locale (spec §8): the cookie is what
// request.ts reads on this device; user_metadata is what the proxy seeds the
// next device from.
export async function setLocale(locale: Locale): Promise<void> {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, LOCALE_COOKIE_OPTIONS);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user && user.user_metadata?.locale !== locale) {
    const { error } = await supabase.auth.updateUser({ data: { locale } });
    // This browser already switched; a failed metadata write only costs the
    // next device its seed. Trace it, don't fail the switch.
    if (error) console.error("[i18n] updateUser locale:", error.message);
  }
  // Scoped to the current page, not `("/", "layout")`: this action runs for
  // anonymous visitors too, and a site-wide layout revalidation would purge
  // the statically prerendered marketing pages. The page the switch happened
  // on is all that must re-render in this roundtrip; the proxy stamps its
  // path onto every request (src/lib/supabase/middleware.ts).
  const path = (await headers()).get("x-pathname")?.split("?")[0] ?? "/";
  revalidatePath(path);
}
