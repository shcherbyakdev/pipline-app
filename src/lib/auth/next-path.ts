// Post-login destinations. Pure and env-free so both the proxy (edge) and
// the auth actions share one rule.
//
// A `next` is accepted only as a same-site PATH: it must start with exactly
// one "/" (so "//evil.com" and "/\evil.com" — which browsers read as
// protocol-relative — are out), carry no whitespace or control characters,
// and never point back at an auth page (a redirect loop). Anything else
// falls back to the dashboard.
const NEXT_RE = /^\/(?![\/\\])[^\s\x00-\x1f\x7f]*$/;
const AUTH_PAGES = ["/login", "/signup", "/forgot-password", "/auth/"];

export const DEFAULT_AFTER_LOGIN = "/bookings";

export function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 512 || !NEXT_RE.test(raw)) return null;
  if (AUTH_PAGES.some((p) => raw === p.replace(/\/$/, "") || raw.startsWith(p) || raw.startsWith(`${p}?`))) {
    return null;
  }
  return raw;
}

export function afterLogin(raw: unknown): string {
  return safeNextPath(raw) ?? DEFAULT_AFTER_LOGIN;
}

// Where the proxy sends an anonymous request. The (dashboard) group's pages
// live at these prefixes; "/embed" alone is the studio (the public widget is
// "/embed/<handle>"), and "/[handle]" is public, so the list is explicit.
export const PROTECTED_PREFIXES = [
  "/bookings",
  "/clients",
  "/services",
  "/team",
  "/availability",
  "/booking-page",
  "/settings",
  "/billing",
  "/overview",
  "/programs",
  "/templates",
  "/rentals",
  "/onboarding",
  "/utils",
  "/dev",
  "/reset-password",
] as const;

export function isProtectedPath(pathname: string): boolean {
  if (pathname === "/embed") return true;
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// The reset flow's proof that this session came from a recovery link, not
// from an unattended tab: set by /auth/confirm on a recovery verification,
// required by updatePassword, cleared once used. Fifteen minutes.
export const RECOVERY_COOKIE = "booklo_recovery";
export const RECOVERY_COOKIE_MAX_AGE = 15 * 60;
