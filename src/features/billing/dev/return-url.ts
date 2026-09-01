import { env } from "@/env";

/** Validate a `?return=` value before it becomes a navigable href.

    `return` rides in the query string of a page anyone signed in can open, so
    it is an open-redirect vector: an off-origin value would turn a link on the
    real app origin into a phishing hop. Absolute URLs back into the app are
    allowed (leaving the emulator is a full navigation); anything off-origin —
    or a `javascript:`/`data:` value, whose parsed origin is opaque and never
    matches — falls back to /billing. Always returns an app-origin absolute URL
    so callers can `new URL(...)` the result without a base. */
export function safeReturnUrl(returnTo: string): string {
  const appUrl = new URL(env.NEXT_PUBLIC_APP_URL);
  try {
    const target = new URL(returnTo, appUrl);
    if (target.origin === appUrl.origin) return target.toString();
  } catch {
    /* unparseable → fallback */
  }
  return new URL("/billing", appUrl).toString();
}
