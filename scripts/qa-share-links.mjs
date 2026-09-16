#!/usr/bin/env node
/**
 * Share links (spec 2026-09-16) browser QA against a local dev server: a link
 * shows exactly what it names, on the hosted page, the embed and the admin
 * embed page's Show checklist.
 *
 *   npm run dev                     # keep it on http://localhost:3000
 *   node scripts/qa-share-links.mjs # prints PASS n/7, exits non-zero on any failure
 *
 * Env: BASE_URL (default http://localhost:3000 — never 127.0.0.1), PLAYWRIGHT_MODULE,
 * QA_HEADED=1. Needs the local demo org in Spaces mode with at least three
 * active, non-equipment spaces (qa-s6-compound.mjs leaves it like that).
 */
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { createClient } from "@supabase/supabase-js";

try { loadEnvFile(".env.local"); } catch { /* already exported */ }

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const HANDLE = "demo-studio";
const EMAIL = "demo@rolloutos.local";
const PASSWORD = "Password123!";
const STALE = "00000000-0000-4000-8000-000000000000";

async function loadChromium() {
  const explicit = process.env.PLAYWRIGHT_MODULE;
  if (explicit) return (await import(explicit)).chromium;
  try { return (await import("playwright")).chromium; } catch { /* npx cache */ }
  const cache = path.join(homedir(), ".npm", "_npx");
  for (const dir of readdirSync(cache)) {
    try { return (await import(path.join(cache, dir, "node_modules", "playwright", "index.mjs"))).chromium; } catch { /* next */ }
  }
  throw new Error("playwright not found — set PLAYWRIGHT_MODULE to its index.mjs");
}

const results = [];
const assert = (cond, message) => { if (!cond) throw new Error(message); };
async function step(n, title, fn) {
  process.stdout.write(`\n── Step ${n}: ${title}\n`);
  try { const d = await fn(); results.push(true); console.log(`   ✓ ${d ?? "ok"}`); }
  catch (e) { results.push(false); console.log(`   ✗ ${e?.message ?? e}`); }
}

// ── the org's spaces (service role, local only) ────────────────────────────
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert(url && key, "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (.env.local)");
assert(["127.0.0.1", "localhost"].includes(new URL(url).hostname), `refusing a non-local Supabase (${url})`);
const db = createClient(url, key, { auth: { persistSession: false } });
const { data: org } = await db.from("orgs").select("id, offers_rentals").eq("handle", HANDLE).single();
assert(org?.offers_rentals, `"${HANDLE}" must be in Spaces mode`);
// The Free cap would hide all but two units from the public catalogue: the
// same dev-only comp plan qa-s6-compound.mjs grants, so every space is public.
const { error: planError } = await db.from("org_plan_overrides").upsert({ org_id: org.id, plan: "team", expires_at: null, note: "share links QA", granted_by: "qa-share-links.mjs" }, { onConflict: "org_id" });
if (planError) throw planError;
console.log("setup: Team plan comp granted (dev database)");
const { data: spaces } = await db.from("rental_offerings").select("id, name, kind").eq("org_id", org.id).eq("active", true).neq("kind", "equipment").order("sort_order");
assert(spaces.length >= 3, `need 3 active spaces, have ${spaces.length}`);
const [A, B, C] = spaces;
console.log(`spaces: A="${A.name}" B="${B.name}" C="${C.name}"`);

const seen = async (page, name) => (await page.getByText(name, { exact: true }).count()) > 0;
// The booking flow opened on a space: the hourly flow asks how long, the
// nights/days flow asks for a start date.
const opened = async (page) => (await seen(page, "How long?")) || (await seen(page, "Pick your start date."));
const waitOpened = (page) => page.getByText(/^(How long\?|Pick your start date\.)$/).first().waitFor();
async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator("#email").fill(EMAIL);
  await page.locator("#password").fill(PASSWORD);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
}

const chromium = await loadChromium();
const browser = await chromium.launch({ headless: !process.env.QA_HEADED });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(20_000);

await step(1, "hosted page, two spaces named: only those two", async () => {
  await page.goto(`${BASE}/${HANDLE}?space=${A.id},${B.id}&lang=en`, { waitUntil: "domcontentloaded" });
  await page.getByText(A.name, { exact: true }).first().waitFor();
  assert(await seen(page, B.name), "B missing");
  assert(!(await seen(page, C.name)), "C leaked through");
  assert(!(await opened(page)), "opened into a space although two were named");
  return "A and B listed, C hidden, nothing pre-opened";
});

await step(2, "hosted page, one space named: opens into it, no way to the others", async () => {
  await page.goto(`${BASE}/${HANDLE}?space=${A.id}&lang=en`, { waitUntil: "domcontentloaded" });
  await waitOpened(page);
  assert(await seen(page, A.name), "A missing");
  assert(!(await seen(page, B.name)) && !(await seen(page, C.name)), "another space leaked through");
  assert((await page.getByRole("button", { name: "Change", exact: true }).count()) === 0, "a Change link is offered");
  return "A opened, no Change link, B and C hidden";
});

await step(3, "embed, one space named: same lock", async () => {
  await page.goto(`${BASE}/embed/${HANDLE}?space=${A.id}&lang=en`, { waitUntil: "domcontentloaded" });
  await waitOpened(page);
  assert(!(await seen(page, B.name)), "B leaked through");
  assert((await page.getByRole("button", { name: "Change", exact: true }).count()) === 0, "a Change link is offered");
  return "embed opened into A only";
});

await step(4, "a stale id degrades to the whole page", async () => {
  await page.goto(`${BASE}/${HANDLE}?space=${STALE}&lang=en`, { waitUntil: "domcontentloaded" });
  await page.getByText(A.name, { exact: true }).first().waitFor();
  assert((await seen(page, B.name)) && (await seen(page, C.name)), "the whole catalogue should show");
  return "A, B and C all listed";
});

await login(page);

await step(5, "admin embed page: the space page's Embed link lands on Selected spaces with it ticked", async () => {
  await page.goto(`${BASE}/embed?space=${A.id}`, { waitUntil: "domcontentloaded" });
  const show = page.locator("#embed-show");
  await show.waitFor();
  assert((await show.inputValue()) === "spaces", `Show is ${await show.inputValue()}`);
  const box = (name) => page.locator("label").filter({ hasText: name }).locator('[role="checkbox"]');
  assert((await box(A.name).getAttribute("aria-checked")) === "true", "A not ticked");
  assert((await box(B.name).getAttribute("aria-checked")) === "false", "B ticked");
  assert((await page.locator("pre").innerText()).includes(`?space=${A.id}"`), "snippet does not name A alone");
  return "Selected spaces, A ticked, snippet ?space=A";
});

await step(6, "tick a second space: the snippet lists both in page order; untick both: the whole page", async () => {
  const box = (name) => page.locator("label").filter({ hasText: name }).locator('[role="checkbox"]');
  await box(B.name).click();
  await page.waitForFunction((needle) => document.querySelector("pre")?.innerText.includes(needle), `?space=${A.id},${B.id}`);
  await box(A.name).click();
  await box(B.name).click();
  await page.waitForFunction(() => !document.querySelector("pre")?.innerText.includes("?space="));
  // The admin speaks the user's language; the hint is the list's one paragraph.
  assert(((await page.locator("fieldset p").innerText()).trim().length) > 20, "hint missing");
  return "?space=A,B then no query; hint shown";
});

await step(7, "space page rail: Copy link and Embed point at this space", async () => {
  await page.goto(`${BASE}/rentals/${A.id}`, { waitUntil: "domcontentloaded" });
  // "Copy link — <name>" in the admin's own language: match on the name.
  await page.locator(`aside button[aria-label$="— ${A.name}"]`).waitFor();
  const href = await page.locator(`a[href="/embed?space=${A.id}"]`).getAttribute("href");
  assert(href, "Embed rail link missing");
  return "rail carries Copy link and Embed for A";
});

await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\nPASS ${passed}/${results.length}`);
process.exit(passed === results.length ? 0 : 1);
