/**
 * 0047: is_handle_available (anon), reserved handles, create_org_with_page.
 * Requires the local Supabase stack.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

try {
  loadEnvFile(".env.local");
} catch {
  // CI exports env directly.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const STAMP = Date.now();
const TAKEN = `hnd-taken-${STAMP}`;
const FRESH = `hnd-fresh-${STAMP}`;

async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `hnd_${tag}_${STAMP}@example.com`;
  const password = "Password123!";
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw e;
  return client;
}

async function available(handle: string | null): Promise<boolean> {
  const { data, error } = await anon.rpc("is_handle_available", { p_handle: handle });
  if (error) throw error;
  return data as boolean;
}

describe("is_handle_available (anon)", () => {
  beforeAll(async () => {
    const owner = await signedInUser("taken");
    const { data: org, error } = await owner.rpc("create_org", { p_name: "Taken Co" });
    if (error) throw error;
    const { error: e2 } = await owner.rpc("update_org_scheduling", {
      p_org_id: (org as { id: string }).id,
      p_handle: TAKEN,
      p_timezone: "Europe/Warsaw",
    });
    if (e2) throw e2;
  });

  it("is true for a free, well-formed handle", async () => {
    expect(await available(FRESH)).toBe(true);
  });
  it("is false for a taken handle", async () => {
    expect(await available(TAKEN)).toBe(false);
  });
  it("is false for reserved words", async () => {
    expect(await available("login")).toBe(false);
    expect(await available("booking-page")).toBe(false);
  });
  it("is false for malformed input and null", async () => {
    expect(await available("Ab")).toBe(false);
    expect(await available("-anna")).toBe(false);
    expect(await available("a".repeat(51))).toBe(false);
    expect(await available(null)).toBe(false);
  });
});

describe("update_org_scheduling rejects reserved handles", () => {
  it("raises for a reserved word", async () => {
    const owner = await signedInUser("reserved");
    const { data: org, error } = await owner.rpc("create_org", { p_name: "Reserved Co" });
    if (error) throw error;
    const { error: e2 } = await owner.rpc("update_org_scheduling", {
      p_org_id: (org as { id: string }).id,
      p_handle: "pricing",
      p_timezone: "Europe/Warsaw",
    });
    expect(e2?.message).toMatch(/reserved handle/);
  });
});

describe("create_org_with_page", () => {
  it("creates the org with handle + timezone and seeds the first staff row", async () => {
    const owner = await signedInUser("page");
    const handle = `hnd-page-${STAMP}`;
    const { data, error } = await owner.rpc("create_org_with_page", {
      p_name: "Anna Studio",
      p_handle: handle,
      p_timezone: "Europe/Berlin",
    });
    if (error) throw error;
    const org = data as { id: string; name: string; handle: string; timezone: string };
    expect(org.name).toBe("Anna Studio");
    expect(org.handle).toBe(handle);
    expect(org.timezone).toBe("Europe/Berlin");
    const { count } = await admin.from("staff").select("id", { count: "exact", head: true }).eq("org_id", org.id);
    expect(count).toBe(1);
    expect(await available(handle)).toBe(false);
  });

  it("accepts a null handle (plain onboarding)", async () => {
    const owner = await signedInUser("nohandle");
    const { data, error } = await owner.rpc("create_org_with_page", {
      p_name: "No Handle Yet",
      p_handle: null,
      p_timezone: "UTC",
    });
    if (error) throw error;
    expect((data as { handle: string | null }).handle).toBeNull();
  });

  it("a taken handle fails with 23505 and leaves no org behind", async () => {
    const owner = await signedInUser("dupe");
    const { data: { user } } = await owner.auth.getUser();
    const { error } = await owner.rpc("create_org_with_page", {
      p_name: "Dupe Co",
      p_handle: TAKEN,
      p_timezone: "UTC",
    });
    expect(error?.code).toBe("23505");
    const { count } = await admin.from("org_members").select("org_id", { count: "exact", head: true }).eq("user_id", user!.id);
    expect(count).toBe(0);
  });

  it("rejects reserved handles and bad timezones", async () => {
    const owner = await signedInUser("bad");
    const r1 = await owner.rpc("create_org_with_page", { p_name: "X Co", p_handle: "signup", p_timezone: "UTC" });
    expect(r1.error?.message).toMatch(/reserved handle/);
    const r2 = await owner.rpc("create_org_with_page", { p_name: "X Co", p_handle: null, p_timezone: "Mars/Olympus" });
    expect(r2.error?.message).toMatch(/not found/);
  });

  it("is not callable by anon", async () => {
    const { error } = await anon.rpc("create_org_with_page", { p_name: "Anon", p_handle: null, p_timezone: "UTC" });
    expect(error).not.toBeNull();
  });
});
