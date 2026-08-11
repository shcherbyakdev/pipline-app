// The recurrence decisions, whole and pure (the cadence.ts discipline): no
// IO, no clock reads — callers inject `now`. value_date is a calendar date
// (YYYY-MM-DD); the core treats it as UTC midnight, matching how the
// migration stamps unit_stages.due_at (value_date::timestamptz on a UTC DB).

const DAY_MS = 86_400_000;

export type RearmCandidate = {
  unitStageId: string;
  valueDate: string; // 'YYYY-MM-DD' from unit_stage_responses.value_date
  recurLeadDays: number;
};

export function rearmDue(valueDate: string, leadDays: number, now: Date): boolean {
  const expiry = Date.parse(`${valueDate}T00:00:00Z`);
  return now.getTime() >= expiry - leadDays * DAY_MS;
}

export type RearmDecision =
  | { kind: "rearm"; dueAt: Date }
  | { kind: "skip"; reason: "not_due" };

export function decideRearm(c: RearmCandidate, ctx: { now: Date }): RearmDecision {
  if (!rearmDue(c.valueDate, c.recurLeadDays, ctx.now)) return { kind: "skip", reason: "not_due" };
  return { kind: "rearm", dueAt: new Date(`${c.valueDate}T00:00:00Z`) };
}

// Console/portal badge derivation from unit_stages.due_at. due_at is only
// ever stamped by recur_rearm; a stage that is done again shows nothing —
// lapse is a property of OUTSTANDING renewal work, not of history.
export type StageDueState =
  | { kind: "none" }
  | { kind: "due"; dueAt: Date }
  | { kind: "lapsed"; days: number };

export function stageDueState(
  dueAt: string | null,
  status: "pending" | "done",
  now: Date,
): StageDueState {
  if (!dueAt || status === "done") return { kind: "none" };
  const due = Date.parse(dueAt);
  if (now.getTime() < due) return { kind: "due", dueAt: new Date(due) };
  return { kind: "lapsed", days: Math.floor((now.getTime() - due) / DAY_MS) };
}
