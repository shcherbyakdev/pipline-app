import { env } from "@/env";

/* The one place the emulator decides where "back to the app" is allowed to
   point. `return` rides in the query string of pages anyone signed in can
   open and in hidden form fields anyone can retype, so every consumer of it
   — the post-checkout redirect, checkout's "Cancel" link, both "Back to
   Booklo" anchors — has to be handed a vetted URL rather than the raw
   parameter. Dev-only is not a reason to hand out an open redirect (or a
   `javascript:` href).

   Deliberately a plain module: no `server-only`, no I/O, no clock — so it is
   unit-testable and can be called from a server component, a server action
   or a shared prop path without any of them thinking about it.

   Always returns an ABSOLUTE URL on the app's own origin, so callers can
   `new URL(...)` the result without a base and without a try/catch. */
const FALLBACK_PATH = "/billing";

export function safeReturnUrl(raw: string | null | undefined): string {
  const appUrl = new URL(env.NEXT_PUBLIC_APP_URL);
  const fallback = new URL(FALLBACK_PATH, appUrl).toString();
  if (!raw) return fallback;
  let target: URL;
  try {
    // A base is required: `raw` is normally relative ("/billing?…"), and the
    // URL constructor throws on those without one.
    target = new URL(raw, appUrl);
  } catch {
    return fallback;
  }
  // Scheme first: `javascript:billing` parses fine and its "origin" is
  // `null`, which would compare unequal below — but relying on that would
  // make the guard an accident rather than a rule.
  if (target.protocol !== "http:" && target.protocol !== "https:") return fallback;
  if (target.origin !== appUrl.origin) return fallback;
  return target.toString();
}

/** A vetted return URL with `params` applied. `.set`, not string
    concatenation: `startCheckout` bakes `checkout=success&plan=…` into the
    `return` it hands the provider so the ACTION can land on it, and appending
    them again would produce `?checkout=success&checkout=success` — which
    `/billing` reads through `searchParams`, where a repeated key arrives as
    an array and matches none of the expected values. */
export function returnUrlWith(raw: string | null | undefined, params: Record<string, string>): string {
  const target = new URL(safeReturnUrl(raw));
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  return target.toString();
}
