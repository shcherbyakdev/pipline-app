/* Dismissed plan notices, remembered in one cookie (the welcome banner's
   precedent: a nudge is not worth a column). A token carries WHAT the notice
   said — the org, the kind, and a signature — so a dismissal ends by itself
   the moment the situation changes: another person falls off the page, the
   reminder quota runs out, a new month starts. */
export const PLAN_NOTICE_COOKIE = "booklo_plan_notice";
export const PLAN_NOTICE_MAX_AGE = 180 * 24 * 60 * 60;

/** Enough for both notices of a couple of orgs; the oldest fall off so the
    cookie header can never grow without bound. */
const KEEP = 6;
/** Both separators are unreserved characters: Next serialises a cookie value
    through encodeURIComponent, and reads it back RAW — a ":" written as
    "%3A" would never match the token built to look it up again. */
const SEP = "~";

export function noticeToken(orgId: string, kind: string, signature: string | number): string {
  return `${orgId}.${kind}.${signature}`;
}

export function isNoticeDismissed(cookie: string | undefined, token: string): boolean {
  return cookie?.split(SEP).includes(token) ?? false;
}

export function withNoticeDismissed(cookie: string | undefined, token: string): string {
  const kept = (cookie?.split(SEP) ?? []).filter((t) => t && t !== token);
  return [...kept, token].slice(-KEEP).join(SEP);
}
