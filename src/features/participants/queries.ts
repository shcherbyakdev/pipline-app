import { createClient } from "@/lib/supabase/server";

export type ParticipantListItem = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
};

export type ProgramLink = {
  id: string;
  participantId: string;
  participantName: string;
  unitId: string | null;
  unitName: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  status: "active" | "expired" | "revoked";
};

// RLS scopes both reads to the caller's orgs.
export async function listParticipants(): Promise<ParticipantListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("participants")
    .select("id, name, email, phone")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function listProgramLinks(programId: string): Promise<ProgramLink[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("access_tokens")
    .select(
      "id, participant_id, unit_id, created_at, expires_at, revoked_at, last_used_at, participants(name), units(name)",
    )
    .eq("program_id", programId)
    .eq("kind", "participant")
    .order("created_at", { ascending: false });
  if (error) throw error;
  type Row = {
    id: string;
    participant_id: string;
    unit_id: string | null;
    created_at: string;
    expires_at: string;
    revoked_at: string | null;
    last_used_at: string | null;
    participants: { name: string } | null;
    units: { name: string } | null;
  };
  const now = Date.now();
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    participantId: r.participant_id,
    participantName: r.participants?.name ?? "—",
    unitId: r.unit_id,
    unitName: r.units?.name ?? null,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    lastUsedAt: r.last_used_at,
    status: r.revoked_at ? "revoked" : Date.parse(r.expires_at) < now ? "expired" : "active",
  }));
}
