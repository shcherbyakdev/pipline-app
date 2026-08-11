import "server-only";
import { createClient } from "@/lib/supabase/server";
import { CHASE_MAX_SENDS } from "./cadence";

export type ChaseListItem = {
  id: string;
  participantName: string;
  unitName: string | null;
  sendsDone: number;
  status: "active" | "stopped" | "completed" | "exhausted" | "stalled";
  createdAt: string;
  stoppedAt: string | null;
  lastError: string | null;
};

// RLS-scoped member read for the console panel.
export async function getProgramChases(programId: string): Promise<ChaseListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chases")
    .select(
      "id, sends_done, next_send_at, stopped_at, completed_at, created_at, last_error, participants(name), units(name)",
    )
    .eq("program_id", programId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((c) => ({
    id: c.id,
    participantName: (c.participants as unknown as { name: string } | null)?.name ?? "—",
    unitName: (c.units as unknown as { name: string } | null)?.name ?? null,
    sendsDone: c.sends_done,
    status: c.completed_at
      ? "completed"
      : c.stopped_at
        ? "stopped"
        // Gave up before finishing the cadence (drain.ts's retry cap) —
        // distinct from "exhausted" (finished all 4 sends normally).
        : c.next_send_at === null && c.sends_done < CHASE_MAX_SENDS
          ? "stalled"
          : c.sends_done >= CHASE_MAX_SENDS
            ? "exhausted"
            : "active",
    createdAt: c.created_at,
    stoppedAt: c.stopped_at,
    lastError: c.last_error,
  }));
}
