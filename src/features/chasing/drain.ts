import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateAccessToken, buildParticipantUrl } from "@/lib/tokens";
import { getOrgBranding } from "@/lib/org-branding";
import { env } from "@/env";
import type { EmailTransport } from "@/lib/email/transport";
import { decide, chaseIdempotencyKey, type ChaseState } from "./cadence";
import { chaseEmail } from "./templates";
import { runRecurPhase, type RecurSummary } from "@/features/recurrence/drain";

export type DrainSummary = {
  sent: number;
  completed: number;
  skipped: number;
  failed: number;
} & RecurSummary;

const BATCH_LIMIT = 25; // bounded tick; leftovers are still due next tick
const TOKEN_EXPIRES_DAYS = 30; // issueLink's default, kept in step
// Bounds orphan tokens at 5 mints per chase. Past this, the chase stalls
// (next_send_at cleared) instead of retrying forever — surfaced to staff
// as "stalled" in queries.ts; each orphaned token still dies at its own
// expiry or at completion.
const CHASE_MAX_ATTEMPTS = 5;

type DueRow = {
  id: string;
  org_id: string;
  participant_id: string;
  program_id: string;
  unit_id: string | null;
  sends_done: number;
  next_send_at: string;
  created_at: string;
  attempt_count: number;
  participants: { name: string; email: string | null } | null;
  programs: { name: string } | null;
  units: { name: string } | null;
  orgs: { name: string } | null;
};

// Any unit assigned to the participant (optionally pinned) with a non-done
// stage = outstanding. Mirrors getParticipantUnits' filters exactly — the
// chase must agree with what the participant flow would show them.
async function hasOutstandingWork(db: SupabaseClient, row: DueRow): Promise<boolean> {
  let q = db
    .from("units")
    .select("id, unit_stages(status)")
    .eq("org_id", row.org_id)
    .eq("program_id", row.program_id)
    .eq("assigned_participant_id", row.participant_id);
  if (row.unit_id) q = q.eq("id", row.unit_id);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).some((u) => u.unit_stages.some((s) => s.status !== "done"));
}

export async function runDrain(deps: {
  db: SupabaseClient;
  transport: EmailTransport;
  now?: Date;
}): Promise<DrainSummary> {
  const { db, transport } = deps;
  const now = deps.now ?? new Date();

  // Recur phase FIRST: a freshly re-armed unit's chase is inserted with
  // next_send_at = now, so the due-scan below emails send #0 this same tick.
  const recur = await runRecurPhase(db, now);
  const summary: DrainSummary = { ...recur, sent: 0, completed: 0, skipped: 0, failed: 0 };

  const { data: due, error } = await db
    .from("chases")
    .select(
      "id, org_id, participant_id, program_id, unit_id, sends_done, next_send_at, created_at, attempt_count, participants(name, email), programs(name), units(name), orgs(name)",
    )
    .lte("next_send_at", now.toISOString())
    .is("completed_at", null)
    .is("stopped_at", null)
    .order("next_send_at", { ascending: true })
    .limit(BATCH_LIMIT);
  if (error) throw error;

  for (const raw of (due ?? []) as unknown as DueRow[]) {
    try {
      const chase: ChaseState = {
        id: raw.id,
        createdAt: new Date(raw.created_at),
        sendsDone: raw.sends_done,
        nextSendAt: new Date(raw.next_send_at),
        stoppedAt: null,
        completedAt: null,
      };
      const outstanding = await hasOutstandingWork(db, raw);
      const decision = decide(chase, { now, hasOutstandingWork: outstanding });

      if (decision.kind === "skip") {
        summary.skipped++;
        continue;
      }
      if (decision.kind === "complete") {
        const { error: e } = await db.rpc("complete_chase", { p_chase_id: raw.id });
        if (e) throw e;
        summary.completed++;
        continue;
      }

      // decision.kind === "send" from here. Check the retry cap BEFORE
      // claiming or minting anything — a chase this far gone gets no more
      // tokens, regardless of whether an email is even present.
      if (raw.attempt_count >= CHASE_MAX_ATTEMPTS) {
        const { error: capErr } = await db
          .from("chases")
          .update({
            next_send_at: null,
            last_error: `gave up after ${CHASE_MAX_ATTEMPTS} attempts`,
          })
          .eq("id", raw.id);
        if (capErr) {
          console.error("[chasing] cap update failed:", raw.id, capErr.code ?? capErr.message);
        }
        summary.failed++;
        continue;
      }

      const email = raw.participants?.email;
      if (!email) {
        // Email removed since the chase started. Record and bump
        // attempt_count (next_send_at is left as-is, so the row stays due) —
        // without the bump this row would never hit the retry cap and, since
        // the due-scan orders next_send_at asc, would monopolize every batch
        // forever. The console surfaces last_error; re-adding an address
        // resumes the chase.
        const { error: noEmailErr } = await db
          .from("chases")
          .update({
            last_error: "participant has no email",
            attempt_count: raw.attempt_count + 1,
          })
          .eq("id", raw.id);
        if (noEmailErr) {
          console.error("[chasing] no-email update failed:", raw.id, noEmailErr.code ?? noEmailErr.message);
        }
        summary.failed++;
        continue;
      }

      // CLAIM first (optimistic, single atomic UPDATE): a racing tick's claim
      // finds sends_done already moved and matches zero rows.
      const { data: claimed, error: claimErr } = await db
        .from("chases")
        .update({
          sends_done: decision.sendIndex + 1,
          next_send_at: decision.nextSendAt?.toISOString() ?? null,
        })
        .eq("id", raw.id)
        .eq("sends_done", decision.sendIndex)
        .is("completed_at", null)
        .is("stopped_at", null)
        .select("id");
      if (claimErr) throw claimErr;
      if (!claimed?.length) {
        summary.skipped++; // lost the race — someone else is sending
        continue;
      }

      try {
        // Raw token lives ONLY in this block: minted, rendered, sent, gone.
        const { token, tokenHash } = generateAccessToken();
        const { error: mintErr } = await db.rpc("mint_chase_token", {
          p_chase_id: raw.id,
          p_token_hash: tokenHash,
          p_expires_at: new Date(now.getTime() + TOKEN_EXPIRES_DAYS * 86_400_000).toISOString(),
        });
        if (mintErr) throw mintErr;

        const branding = await getOrgBranding(raw.org_id);
        const url = buildParticipantUrl(token);
        const msg = chaseEmail({
          sendIndex: decision.sendIndex,
          orgName: raw.orgs?.name ?? "",
          branding,
          programName: raw.programs?.name ?? "",
          unitLine: raw.units?.name ?? null,
          url,
          stopUrl: `${env.NEXT_PUBLIC_APP_URL}/p/${token}/stop`,
        });
        await transport.send({
          to: email,
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          idempotencyKey: chaseIdempotencyKey(raw.id, decision.sendIndex),
        });
        summary.sent++;
      } catch (sendErr) {
        // Roll the claim back so the row is simply STILL DUE next tick.
        // The minted token (if any) stays live until completion/expiry —
        // an accepted orphan; the idempotency key makes the retry safe even
        // if the failure was a lie (timeout after delivery).
        // Guarded by completed_at/stopped_at is null: if complete_chase or
        // stop_chase landed while the send was in flight, next_send_at is
        // already null (or the row is otherwise finished) — this rollback
        // must not resurrect a due date on a row that just finished.
        const { error: rollbackErr } = await db
          .from("chases")
          .update({
            sends_done: decision.sendIndex,
            next_send_at: raw.next_send_at,
            last_error: sendErr instanceof Error ? sendErr.message.slice(0, 500) : "send failed",
            attempt_count: raw.attempt_count + 1,
          })
          .eq("id", raw.id)
          .eq("sends_done", decision.sendIndex + 1)
          .is("completed_at", null)
          .is("stopped_at", null);
        if (rollbackErr) {
          // Rollback is the recovery path for a failed send — if IT also
          // fails, the row is left claimed with no due date and no visible
          // error. That's unrecoverable without this log line.
          console.error("[chasing] rollback update failed:", raw.id, rollbackErr.code ?? rollbackErr.message);
        }
        summary.failed++;
      }
    } catch (rowErr) {
      // Per-chase isolation: one bad row never stops the batch. Bump
      // attempt_count here too — an unexpected/thrown failure is just as
      // capable of recurring forever as a transport failure, and the retry
      // cap only ever reads this counter.
      console.error("[chasing] drain row failed:", raw.id, rowErr instanceof Error ? rowErr.message : rowErr);
      const { error: catchErr } = await db
        .from("chases")
        .update({
          last_error: rowErr instanceof Error ? rowErr.message.slice(0, 500) : "drain error",
          attempt_count: raw.attempt_count + 1,
        })
        .eq("id", raw.id);
      if (catchErr) {
        console.error("[chasing] catch update failed:", raw.id, catchErr.code ?? catchErr.message);
      }
      summary.failed++;
    }
  }
  return summary;
}
