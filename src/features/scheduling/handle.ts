// The booking-page handle: booklo.co/<handle>. One module for the rule, the
// reserved words and the helpers the landing claim bar, signup and onboarding
// share. The DB enforces the same rule (orgs_handle_format_check, 0026) and
// the same reserved list (reserved_handles(), 0051) — handle.test.ts asserts
// the two lists are identical.

export const HANDLE_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
export const HANDLE_MAX = 50;

// Every top-level app route (a handle must never shadow one now that the
// public page answers at /<handle>), plus generic names nobody should own.
// Keep in sync with reserved_handles() in 0051_handles.sql (last redefined in 0076).
export const RESERVED_HANDLES = [
  "api", "auth", "availability", "billing", "book", "booking", "booking-page", "bookings",
  "clients", "dev", "embed", "forgot-password", "login", "onboarding", "overview", "payments", "portal",
  "pricing", "privacy", "programs", "rentals", "reset-password", "services", "settings", "signup",
  "team", "templates", "terms", "utils", "waitlist", "notifications", "integrations",
  "admin", "app", "www", "mail", "help", "support", "docs", "blog", "about", "contact", "status",
  "static", "assets", "public", "booklo", "new", "home", "index", "sitemap", "robots",
  "favicon",
] as const;

const RESERVED = new Set<string>(RESERVED_HANDLES);

export function isReservedHandle(handle: string): boolean {
  return RESERVED.has(handle);
}

// Letters NFKD decomposition doesn't split into base + combining mark, so
// the generic diacritic strip below never touches them — without this map
// they'd just be deleted (e.g. "Łukasz" → "ukasz").
const TRANSLITERATE: Record<string, string> = {
  "ł": "l", "ß": "ss", "ø": "o", "đ": "d", "æ": "ae", "œ": "oe", "þ": "th", "ð": "d",
};

// Live-typing normaliser: the field only ever shows a legal prefix of a
// handle. A trailing dash is allowed mid-typing; HANDLE_RE rejects it on
// submit and the hint explains.
export function normalizeHandle(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[łßøđæœþð]/g, (m) => TRANSLITERATE[m])
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "")
    .slice(0, HANDLE_MAX);
}

export function toDisplayName(handle: string): string {
  return handle
    .split("-")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

const SUFFIXES = ["-studio", "-booking", "-2", "-3"] as const;

export function suggestHandles(handle: string): string[] {
  const base = normalizeHandle(handle).replace(/-+$/, "");
  return SUFFIXES.map((s) => base.slice(0, HANDLE_MAX - s.length).replace(/-+$/, "") + s).filter((c) =>
    HANDLE_RE.test(c),
  );
}
