// The chase cadence, whole and pure. No IO, no clock reads — callers inject
// `now` and the outstanding-work answer, which is what makes the entire
// schedule unit-testable. Offsets are measured from created_at, NEVER from
// the last send: a late drain tick cannot push the schedule rightward.
export const CHASE_OFFSET_DAYS = [0, 3, 7, 14] as const;
export const CHASE_MAX_SENDS = CHASE_OFFSET_DAYS.length;

export type ChaseState = {
  id: string;
  createdAt: Date;
  sendsDone: number;
  nextSendAt: Date | null;
  stoppedAt: Date | null;
  completedAt: Date | null;
};

export function nextSendAt(createdAt: Date, sendsDone: number): Date | null {
  const offset = CHASE_OFFSET_DAYS[sendsDone];
  if (offset === undefined) return null;
  return new Date(createdAt.getTime() + offset * 86_400_000);
}

// Resend deduplicates on this for 24h — a crash-retry or racing tick
// re-sending the SAME send index cannot produce a duplicate email.
export function chaseIdempotencyKey(chaseId: string, sendIndex: number): string {
  return `chase/${chaseId}/send/${sendIndex}`;
}

export type ChaseDecision =
  | { kind: "send"; sendIndex: number; nextSendAt: Date | null }
  | { kind: "complete" }
  | { kind: "skip"; reason: "terminal" | "exhausted" | "not_due" };

export function decide(
  chase: ChaseState,
  ctx: { now: Date; hasOutstandingWork: boolean },
): ChaseDecision {
  if (chase.stoppedAt || chase.completedAt) return { kind: "skip", reason: "terminal" };
  // Completion outranks everything else live: no email ever follows done work.
  if (!ctx.hasOutstandingWork) return { kind: "complete" };
  if (chase.sendsDone >= CHASE_MAX_SENDS || chase.nextSendAt === null)
    return { kind: "skip", reason: "exhausted" };
  if (ctx.now < chase.nextSendAt) return { kind: "skip", reason: "not_due" };
  return {
    kind: "send",
    sendIndex: chase.sendsDone,
    nextSendAt: nextSendAt(chase.createdAt, chase.sendsDone + 1),
  };
}
