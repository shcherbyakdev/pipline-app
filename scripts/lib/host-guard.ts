/**
 * Loopback-host check shared by scripts that must never act — especially
 * destructively — against a remote or staging Postgres/Supabase project.
 * Pure: no fs, no process, no network. Just URL parsing and string
 * comparison, so both call sites can share one tested implementation
 * instead of drifting.
 */

// Parsed with `new URL(...).hostname`, not a substring match, so a value
// crafted like "postgres://evil.com/?x=127.0.0.1" cannot slip through.
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Extracts the hostname from a URL-shaped string. Works for `http(s)://`
 * URLs and for Postgres connection strings (`postgres(ql)://user:pass@host:
 * port/db`) alike — the WHATWG URL parser treats the authority component
 * the same way regardless of scheme. Returns `null` instead of throwing
 * when `rawUrl` is missing, empty, or not a valid URL.
 */
export function hostnameOf(rawUrl: string | undefined | null): string | null {
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return null;
  }
}

/** True when `hostname` is a loopback address (127.0.0.1, localhost, [::1]). */
export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname);
}
