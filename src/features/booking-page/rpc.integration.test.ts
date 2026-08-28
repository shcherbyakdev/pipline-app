/**
 * Booking page builder RPCs + table access: save_booking_page_draft,
 * publish_booking_page, discard_booking_page_draft, and the RLS/grants on
 * booking_pages. Requires the local Supabase stack.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_PAGE } from "./defaults";

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

async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `rls_${tag}_${Date.now()}@example.com`;
  const password = "Password123!";
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return client;
}

let owner: SupabaseClient;
let stranger: SupabaseClient;
let orgId: string;
let strangerOrgId: string;

const header = DEFAULT_PAGE.sections[0]!;
const booking = DEFAULT_PAGE.sections[1]!;
const withHero = {
  ...DEFAULT_PAGE,
  sections: [header, { id: "hero0001", type: "hero", hidden: false, headline: "Hi", subheadline: "", align: "left" }, booking],
};

beforeAll(async () => {
  owner = await signedInUser("bp_owner");
  stranger = await signedInUser("bp_stranger");
  const { data: org, error } = await owner.rpc("create_org", { p_name: "PageCo" });
  if (error) throw error;
  orgId = (org as { id: string }).id;
  const { data: org2, error: e2 } = await stranger.rpc("create_org", { p_name: "StrangerPageCo" });
  if (e2) throw e2;
  strangerOrgId = (org2 as { id: string }).id;
});

describe("save_booking_page_draft", () => {
  it("member upserts the draft; published stays null", async () => {
    const { error } = await owner.rpc("save_booking_page_draft", { p_org_id: orgId, p_doc: DEFAULT_PAGE });
    expect(error).toBeNull();
    const { data } = await admin.from("booking_pages").select("draft, published").eq("org_id", orgId).single();
    expect(data!.draft).toEqual(DEFAULT_PAGE);
    expect(data!.published).toBeNull();
    const { error: e2 } = await owner.rpc("save_booking_page_draft", { p_org_id: orgId, p_doc: withHero });
    expect(e2).toBeNull();
    const { data: d2 } = await admin.from("booking_pages").select("draft").eq("org_id", orgId).single();
    expect(d2!.draft).toEqual(withHero);
  });
  it("accepts two booking sections — one per channel (0059)", async () => {
    const split = { ...DEFAULT_PAGE, sections: [header, { ...booking, channel: "appointments" }, { ...booking, id: "bookspcs", channel: "spaces" }] };
    expect((await owner.rpc("save_booking_page_draft", { p_org_id: orgId, p_doc: split })).error).toBeNull();
    // Leave the draft as the tests below expect it.
    expect((await owner.rpc("save_booking_page_draft", { p_org_id: orgId, p_doc: withHero })).error).toBeNull();
  });
  it("rejects a non-member, a wrong version, no booking section, three booking sections, a non-object", async () => {
    expect((await stranger.rpc("save_booking_page_draft", { p_org_id: orgId, p_doc: DEFAULT_PAGE })).error).not.toBeNull();
    for (const bad of [
      { ...DEFAULT_PAGE, version: 2 },
      { ...DEFAULT_PAGE, sections: [header] },
      { ...DEFAULT_PAGE, sections: [header, booking, { ...booking, id: "booking2" }, { ...booking, id: "booking3" }] },
      [],
    ]) {
      const { error } = await owner.rpc("save_booking_page_draft", { p_org_id: orgId, p_doc: bad });
      expect(error, JSON.stringify(bad)).not.toBeNull();
    }
  });
  it("rejects a document over 64 KB with the size sentinel", async () => {
    const big = { ...DEFAULT_PAGE, sections: [{ ...header, tagline: "x".repeat(70_000) }, booking] };
    const { error } = await owner.rpc("save_booking_page_draft", { p_org_id: orgId, p_doc: big });
    expect(error?.message).toBe("too large");
  });
});

describe("publish / discard", () => {
  it("publish copies the draft and stamps published_at", async () => {
    const { error } = await owner.rpc("publish_booking_page", { p_org_id: orgId });
    expect(error).toBeNull();
    const { data } = await admin.from("booking_pages").select("draft, published, published_at").eq("org_id", orgId).single();
    expect(data!.published).toEqual(data!.draft);
    expect(data!.published_at).not.toBeNull();
  });
  it("discard reverts the draft to the published document", async () => {
    await owner.rpc("save_booking_page_draft", { p_org_id: orgId, p_doc: DEFAULT_PAGE });
    const { error } = await owner.rpc("discard_booking_page_draft", { p_org_id: orgId, p_fallback: DEFAULT_PAGE });
    expect(error).toBeNull();
    const { data } = await admin.from("booking_pages").select("draft").eq("org_id", orgId).single();
    expect(data!.draft).toEqual(withHero);
  });
  it("discard falls back to p_fallback when never published, and is a no-op without a row", async () => {
    expect((await stranger.rpc("discard_booking_page_draft", { p_org_id: strangerOrgId, p_fallback: DEFAULT_PAGE })).error).toBeNull();
    await stranger.rpc("save_booking_page_draft", { p_org_id: strangerOrgId, p_doc: withHero });
    const { error } = await stranger.rpc("discard_booking_page_draft", { p_org_id: strangerOrgId, p_fallback: DEFAULT_PAGE });
    expect(error).toBeNull();
    const { data } = await admin.from("booking_pages").select("draft, published").eq("org_id", strangerOrgId).single();
    expect(data!.published).toBeNull();
    expect(data!.draft).toEqual(DEFAULT_PAGE);
  });
  it("publish and discard reject a non-member; publish rejects an org with no row", async () => {
    expect((await stranger.rpc("publish_booking_page", { p_org_id: orgId })).error).not.toBeNull();
    expect((await stranger.rpc("discard_booking_page_draft", { p_org_id: orgId, p_fallback: DEFAULT_PAGE })).error).not.toBeNull();
    const third = await signedInUser("bp_third");
    const { data: org3 } = await third.rpc("create_org", { p_name: "NoRowCo" });
    expect((await third.rpc("publish_booking_page", { p_org_id: (org3 as { id: string }).id })).error).not.toBeNull();
  });
});

describe("table access", () => {
  it("member selects own row; stranger sees nothing; anon is refused; member cannot write", async () => {
    const mine = await owner.from("booking_pages").select("org_id").eq("org_id", orgId);
    expect(mine.error).toBeNull();
    expect(mine.data).toHaveLength(1);
    expect((await stranger.from("booking_pages").select("org_id").eq("org_id", orgId)).data ?? []).toHaveLength(0);
    expect((await anon.from("booking_pages").select("org_id")).error).not.toBeNull();
    expect((await owner.from("booking_pages").update({ published: DEFAULT_PAGE }).eq("org_id", orgId)).error).not.toBeNull();
    expect((await owner.from("booking_pages").delete().eq("org_id", orgId)).error).not.toBeNull();
  });
});

describe("getPublishedPage", () => {
  // Dynamic import: queries.ts reaches @/env through the admin client, which
  // parses process.env at module load — after loadEnvFile() above.
  it("returns the published document, and DEFAULT_PAGE when never published or unparseable", async () => {
    const { getPublishedPage } = await import("./queries");
    await owner.rpc("save_booking_page_draft", { p_org_id: orgId, p_doc: withHero });
    await owner.rpc("publish_booking_page", { p_org_id: orgId });
    expect(await getPublishedPage(orgId)).toEqual(withHero);
    expect(await getPublishedPage(strangerOrgId)).toEqual(DEFAULT_PAGE);
    // Junk that passes the SQL checks but not zod: the renderer must never trust it.
    await admin.from("booking_pages").update({ published: { ...withHero, layout: "diagonal" } }).eq("org_id", orgId);
    expect(await getPublishedPage(orgId)).toEqual(DEFAULT_PAGE);
    await owner.rpc("publish_booking_page", { p_org_id: orgId });
  });
});
