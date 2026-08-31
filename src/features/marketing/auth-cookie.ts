// Client-side "probably signed in" check for the marketing nav, from a
// document.cookie string. @supabase/ssr names its session cookie
// sb-<project-ref>-auth-token (chunked: .0, .1, …) and deliberately leaves it
// JS-readable. The -code-verifier cookie is PKCE state that exists before a
// login completes, so it does not count. Presence ≠ validity: a stale cookie
// only means the Dashboard link bounces through /login, same as today.
export function hasAuthCookie(cookieString: string): boolean {
  return cookieString.split(";").some((pair) => {
    const name = pair.slice(0, pair.indexOf("=")).trim();
    return name.startsWith("sb-") && name.includes("-auth-token") && !name.includes("-code-verifier");
  });
}
