/**
 * Public booking write path: create_booking + resolve_booking_token +
 * the EXCLUDE double-book guard. Requires the local Supabase stack.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateAccessToken } from "@/lib/tokens/mint";

try {
  loadEnvFile(".env.local");
} catch {
  // CI exports env directly.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const HANDLE = `bkg-rpc-${Date.now()}`;
const START = "2027-03-01T10:00:00Z";

async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `rls_${tag}_${Date.now()}@example.com`;
  const password = "Password123!";
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return client;
}

describe("create_booking RPC", () => {
  let owner: SupabaseClient;
  let orgId: string;
  let serviceId: string;

  beforeAll(async () => {
    owner = await signedInUser("bkg_owner");
    const { data: org, error: e1 } = await owner.rpc("create_org", { p_name: "BookingCo" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    const { error: e2 } = await owner.rpc("update_org_scheduling", {
      p_org_id: orgId,
      p_handle: HANDLE,
      p_timezone: "Europe/Berlin",
    });
    if (e2) throw e2;
    const { data: svc, error: e3 } = await owner
      .from("services")
      // window 365: the fixed 2027 test dates must stay inside the
      // booking window create_booking enforces (default 60 would reject
      // them with its uniform 'not found').
      .insert({ org_id: orgId, name: "Consult", duration_min: 60, booking_window_days: 365 })
      .select("id")
      .single();
    if (e3) throw e3;
    serviceId = svc!.id;
  });

  it("update_org_scheduling rejects a bogus timezone and a bad handle", async () => {
    const { error: tz } = await owner.rpc("update_org_scheduling", {
      p_org_id: orgId,
      p_handle: HANDLE,
      p_timezone: "Mars/Olympus",
    });
    expect(tz).not.toBeNull();
    const { error: h } = await owner.rpc("update_org_scheduling", {
      p_org_id: orgId,
      p_handle: "Bad Handle!",
      p_timezone: "Europe/Berlin",
    });
    expect(h).not.toBeNull();
  });

  it("anon books happy-path: booking + upserted client + resolvable token", async () => {
    const { token, tokenHash } = generateAccessToken();
    const { data, error } = await anon.rpc("create_booking", {
      p_handle: HANDLE,
      p_service_id: serviceId,
      p_starts_at: START,
      p_name: "Jamie Doe",
      p_email: "Jamie@Example.com",
      p_note: "first visit",
      p_token_hash: tokenHash,
    });
    expect(error).toBeNull();
    const bookingId = data as string;

    const { data: booking } = await admin
      .from("bookings")
      .select("org_id, service_id, client_id, client_email, status, ends_at")
      .eq("id", bookingId)
      .single();
    expect(booking!.org_id).toBe(orgId);
    expect(booking!.client_email).toBe("jamie@example.com"); // lowercased
    expect(booking!.status).toBe("confirmed");
    expect(new Date(booking!.ends_at).toISOString()).toBe("2027-03-01T11:00:00.000Z");

    const { data: client } = await admin
      .from("clients")
      .select("id, name")
      .eq("org_id", orgId)
      .eq("email", "jamie@example.com")
      .single();
    expect(client!.id).toBe(booking!.client_id);

    const { data: resolved, error: rErr } = await anon.rpc("resolve_booking_token", {
      p_token: token,
    });
    expect(rErr).toBeNull();
    const row = (resolved as Array<{ booking_id: string; org_timezone: string }>)[0];
    expect(row.booking_id).toBe(bookingId);
    expect(row.org_timezone).toBe("Europe/Berlin");
  });

  it("re-booking with the same email reuses the client row", async () => {
    const { tokenHash } = generateAccessToken();
    const { error } = await anon.rpc("create_booking", {
      p_handle: HANDLE,
      p_service_id: serviceId,
      p_starts_at: "2027-03-02T10:00:00Z",
      p_name: "Jamie D.",
      p_email: "jamie@example.com",
      p_note: null,
      p_token_hash: tokenHash,
    });
    expect(error).toBeNull();
    const { data: clients } = await admin
      .from("clients")
      .select("id")
      .eq("org_id", orgId)
      .eq("email", "jamie@example.com");
    expect(clients!.length).toBe(1);
  });

  it("overlapping confirmed booking is rejected with 23P01", async () => {
    const { tokenHash } = generateAccessToken();
    const { error } = await anon.rpc("create_booking", {
      p_handle: HANDLE,
      p_service_id: serviceId,
      p_starts_at: "2027-03-01T10:30:00Z", // overlaps the 10:00–11:00 booking
      p_name: "Race Loser",
      p_email: "race@example.com",
      p_note: null,
      p_token_hash: tokenHash,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23P01");
  });

  it("back-to-back booking (11:00 after 10:00–11:00) is allowed", async () => {
    const { tokenHash } = generateAccessToken();
    const { error } = await anon.rpc("create_booking", {
      p_handle: HANDLE,
      p_service_id: serviceId,
      p_starts_at: "2027-03-01T11:00:00Z",
      p_name: "Adjacent",
      p_email: "adjacent@example.com",
      p_note: null,
      p_token_hash: tokenHash,
    });
    expect(error).toBeNull();
  });

  it("unknown handle, inactive service, and past start are all generic misses", async () => {
    const { tokenHash } = generateAccessToken();
    const { error: badHandle } = await anon.rpc("create_booking", {
      p_handle: "no-such-handle",
      p_service_id: serviceId,
      p_starts_at: "2027-03-03T10:00:00Z",
      p_name: "X",
      p_email: "x@example.com",
      p_note: null,
      p_token_hash: tokenHash,
    });
    expect(badHandle).not.toBeNull();
    expect(badHandle!.message).toContain("not found");

    const { error: deactivateErr } = await admin
      .from("services")
      .update({ active: false })
      .eq("id", serviceId);
    expect(deactivateErr).toBeNull();
    const { error: inactive } = await anon.rpc("create_booking", {
      p_handle: HANDLE,
      p_service_id: serviceId,
      p_starts_at: "2027-03-03T10:00:00Z",
      p_name: "X",
      p_email: "x@example.com",
      p_note: null,
      p_token_hash: generateAccessToken().tokenHash,
    });
    expect(inactive).not.toBeNull();
    const { error: reactivateErr } = await admin
      .from("services")
      .update({ active: true })
      .eq("id", serviceId);
    expect(reactivateErr).toBeNull();

    const { error: past } = await anon.rpc("create_booking", {
      p_handle: HANDLE,
      p_service_id: serviceId,
      p_starts_at: "2020-01-01T10:00:00Z",
      p_name: "X",
      p_email: "x@example.com",
      p_note: null,
      p_token_hash: generateAccessToken().tokenHash,
    });
    expect(past).not.toBeNull();
  });

  it("resolve_booking_token returns empty for a wrong token", async () => {
    const { data } = await anon.rpc("resolve_booking_token", {
      p_token: "definitely-not-a-real-token-value",
    });
    expect(data).toEqual([]);
  });

  it("cancelled bookings stop blocking the slot", async () => {
    await admin
      .from("bookings")
      .update({ status: "cancelled_by_provider" })
      .eq("org_id", orgId)
      .eq("starts_at", START);
    const { error } = await anon.rpc("create_booking", {
      p_handle: HANDLE,
      p_service_id: serviceId,
      p_starts_at: START,
      p_name: "Second Chance",
      p_email: "second@example.com",
      p_note: null,
      p_token_hash: generateAccessToken().tokenHash,
    });
    expect(error).toBeNull();
  });
});
