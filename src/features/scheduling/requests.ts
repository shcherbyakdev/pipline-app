// "Expired" is computed, never stored (0062): a pending row whose start has
// passed simply lapsed — it no longer blocks future availability (its range
// is in the past) and must not appear as an actionable request anywhere.
type RequestLike = { status: string; startsAt: string | Date };

export function isPendingRequest(b: RequestLike, now: Date): boolean {
  return b.status === "pending" && new Date(b.startsAt).getTime() > now.getTime();
}

export function isExpiredRequest(b: RequestLike, now: Date): boolean {
  return b.status === "pending" && new Date(b.startsAt).getTime() <= now.getTime();
}
