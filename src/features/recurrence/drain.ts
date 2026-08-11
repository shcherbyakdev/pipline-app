import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decideRearm } from "./core";

export type RecurSummary = {
  rearmed: number;
  chasesStarted: number;
  recurSkipped: number;
  recurFailed: number;
};

const RECUR_BATCH_LIMIT = 25; // bounded tick; leftovers are still due next tick

type DueStage = {
  unit_stage_id: string;
  unit_id: string;
  program_id: string;
  org_id: string;
  value_date: string;
  recur_lead_days: number;
  assigned_participant_id: string | null;
  participant_email: string | null;
};

// Phase 1 of the drain tick: re-arm due stages, then start their chases so
// phase 2 (the chase due-scan) emails send #0 in the SAME tick.
export async function runRecurPhase(db: SupabaseClient, now: Date): Promise<RecurSummary> {
  const summary: RecurSummary = { rearmed: 0, chasesStarted: 0, recurSkipped: 0, recurFailed: 0 };
  const { data, error } = await db.rpc("recur_due", {
    p_today: now.toISOString().slice(0, 10),
    p_limit: RECUR_BATCH_LIMIT,
  });
  if (error) throw error;

  for (const row of (data ?? []) as DueStage[]) {
    try {
      // Pure gate: cheap, fake-clock-tested re-check of what SQL selected.
      const decision = decideRearm(
        { unitStageId: row.unit_stage_id, valueDate: row.value_date, recurLeadDays: row.recur_lead_days },
        { now },
      );
      if (decision.kind === "skip") {
        summary.recurSkipped++;
        continue;
      }

      const { data: claimed, error: rearmErr } = await db.rpc("recur_rearm", {
        p_unit_stage_id: row.unit_stage_id,
      });
      if (rearmErr) throw rearmErr;
      if (!claimed) {
        summary.recurSkipped++; // lost the race, or the stage moved meanwhile
        continue;
      }
      summary.rearmed++;

      // Auto-chase only when there is someone to email; otherwise the stage
      // just sits outstanding in the console — by design, not an error.
      if (!row.assigned_participant_id || !row.participant_email) continue;
      const { error: chaseErr } = await db.from("chases").insert({
        org_id: row.org_id,
        participant_id: row.assigned_participant_id,
        program_id: row.program_id,
        unit_id: row.unit_id,
        next_send_at: now.toISOString(),
        created_by: null, // null = automatic (recurrence)
      });
      if (chaseErr) {
        if (chaseErr.code === "23505") continue; // existing live chase for the scope wins
        throw chaseErr;
      }
      summary.chasesStarted++;
    } catch (rowErr) {
      // Per-stage isolation: one bad row never stops the batch (drain.ts idiom).
      console.error(
        "[recurrence] rearm failed:",
        row.unit_stage_id,
        rowErr instanceof Error ? rowErr.message : rowErr,
      );
      summary.recurFailed++;
    }
  }
  return summary;
}
