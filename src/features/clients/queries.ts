import { createClient as createSupabase } from "@/lib/supabase/server";
import { bookingTitle } from "@/features/scheduling/booking-label";

export type ClientOption = { id: string; name: string };
export type ClientUnitRow = {
  unitId: string;
  unitName: string;
  externalRef: string | null;
  programId: string;
  programName: string;
  done: number;
  total: number;
};
export type ClientLink = {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  status: "active" | "expired" | "revoked";
};

// RLS scopes every read to the caller's orgs.

export async function listClientOptions(): Promise<ClientOption[]> {
  const supabase = await createSupabase();
  const { data, error } = await supabase.from("clients").select("id, name").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function getClient(
  id: string,
): Promise<{ id: string; name: string; email: string | null; createdAt: string } | null> {
  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, email, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data
    ? { id: data.id, name: data.name, email: data.email, createdAt: data.created_at }
    : null;
}

export async function listClientUnits(clientId: string): Promise<ClientUnitRow[]> {
  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from("units")
    .select("id, name, external_ref, program_id, programs(name), unit_stages(status)")
    .eq("client_id", clientId);
  if (error) throw error;
  type Row = {
    id: string;
    name: string;
    external_ref: string | null;
    program_id: string;
    programs: { name: string } | null;
    unit_stages: { status: string }[];
  };
  return ((data ?? []) as unknown as Row[])
    .map((u) => ({
      unitId: u.id,
      unitName: u.name,
      externalRef: u.external_ref,
      programId: u.program_id,
      programName: u.programs?.name ?? "—",
      done: u.unit_stages.filter((s) => s.status === "done").length,
      total: u.unit_stages.length,
    }))
    .sort(
      (a, b) =>
        a.programName.localeCompare(b.programName) ||
        a.unitName.localeCompare(b.unitName) ||
        a.unitId.localeCompare(b.unitId),
    );
}

export async function listClientLinks(clientId: string): Promise<ClientLink[]> {
  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from("access_tokens")
    .select("id, created_at, expires_at, revoked_at, last_used_at")
    .eq("client_id", clientId)
    .eq("kind", "portal")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const now = Date.now();
  return (data ?? []).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    lastUsedAt: r.last_used_at,
    status: r.revoked_at ? "revoked" : Date.parse(r.expires_at) < now ? "expired" : "active",
  }));
}

export type ClientDirectoryRow = {
  id: string;
  name: string;
  email: string | null;
  bookingCount: number;
};

// Scheduling directory (S5): embedded count rides member RLS on bookings.
export async function listClientsDirectory(): Promise<ClientDirectoryRow[]> {
  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, email, bookings(count)")
    .order("name");
  if (error) throw error;
  type Row = {
    id: string;
    name: string;
    email: string | null;
    bookings: { count: number }[];
  };
  return ((data ?? []) as unknown as Row[])
    .map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      bookingCount: c.bookings[0]?.count ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type ClientBookingRow = {
  id: string;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  // Rentals R1: non-null for a stay, which renders as a range rather than
  // a single instant (see whenLineFor).
  rentalUnitId: string | null;
  status: string;
  note: string | null;
};

export async function listClientBookings(clientId: string): Promise<ClientBookingRow[]> {
  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from("bookings")
    .select(
      "id, starts_at, ends_at, rental_unit_id, status, note, services(name), rental_offerings(name), rental_units(name)",
    )
    .eq("client_id", clientId)
    .order("starts_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  type Row = {
    id: string;
    starts_at: string;
    ends_at: string;
    rental_unit_id: string | null;
    status: string;
    note: string | null;
    services: { name: string } | null;
    rental_offerings: { name: string } | null;
    rental_units: { name: string } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((b) => ({
    id: b.id,
    serviceName: bookingTitle(b),
    startsAt: b.starts_at,
    endsAt: b.ends_at,
    rentalUnitId: b.rental_unit_id,
    status: b.status,
    note: b.note,
  }));
}
