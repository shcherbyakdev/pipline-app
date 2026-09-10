#!/usr/bin/env node
/**
 * Landing screenshots — the real product, on real data, for the hero.
 *
 *   npm run dev                       # keep it on http://localhost:3000
 *   node scripts/landing-shots.mjs    # writes src/features/marketing/images/*.png
 *
 * Dresses the LOCAL demo org (dev database only, announced on stdout) as a
 * multi-room studio — "Studio Halo": Room A, Room B, a make-up room, the
 * whole studio as a package of the three, a two-item lamp kit — books one
 * October week through the public page with fictional clients, then
 * screenshots the admin week and the hosted page at 2x. Idempotent: spaces
 * and bookings are skipped when they already exist.
 *
 * Env: BASE_URL (default http://localhost:3000 — never 127.0.0.1, Next dev
 * blocks the HMR socket cross-origin), PLAYWRIGHT_MODULE (override the
 * Playwright entry; default: the installed package, else the newest npx
 * cache copy).
 */
import { readdirSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { createClient } from "@supabase/supabase-js";

try {
  loadEnvFile(".env.local");
} catch {
  // Already-exported env is fine.
}

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const HANDLE = "demo-studio";
const EMAIL = "demo@rolloutos.local";
const PASSWORD = "Password123!";
const ORG_NAME = "Studio Halo";
const OUT = path.join("src", "features", "marketing", "images");

/** The week on show: a Monday. Bookings and the admin screenshot use it. */
const WEEK = "2026-10-05";

const SPACES = [
  { key: "roomA", kind: "space", name: "Room A", price: 140 },
  { key: "roomB", kind: "space", name: "Room B", price: 110 },
  { key: "makeup", kind: "space", name: "Make-up room", price: 60 },
  { key: "studio", kind: "composite", name: "Whole studio", price: 320, components: ["Room A", "Room B", "Make-up room"] },
  { key: "lamp", kind: "equipment", name: "Profoto B10 kit", price: 50, itemCount: 2 },
];

/** day offset from WEEK, start "HH:MM", hours, space key, client, lamps. */
const BOOKINGS = [
  { d: 0, time: "10:00", h: 4, space: "roomA", name: "Mia Novak", lamps: 1 },
  { d: 0, time: "15:00", h: 3, space: "roomB", name: "Jan Kowalski" },
  { d: 1, time: "09:00", h: 3, space: "roomB", name: "Ola Nowak" },
  { d: 1, time: "13:00", h: 4, space: "roomA", name: "Marek Zieliński", lamps: 2 },
  { d: 2, time: "10:00", h: 4, space: "studio", name: "Tomasz Reyes" },
  { d: 3, time: "09:00", h: 2, space: "roomA", name: "Ewa Lis" },
  { d: 3, time: "09:00", h: 2, space: "makeup", name: "Ewa Lis" },
  { d: 3, time: "14:00", h: 4, space: "roomB", name: "Lena Fischer", lamps: 1 },
  { d: 4, time: "12:00", h: 4, space: "roomA", name: "Kasia Wójcik", lamps: 1 },
  { d: 4, time: "10:00", h: 3, space: "roomB", name: "Piotr Mazur" },
];
/* The weekend stays empty on purpose: the hero seats the phone over those
   two columns. Anything booked there from an earlier run is cancelled. */

const dayCellLabel = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const emailFor = (name) =>
  `${name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, ".")}@example.com`;

async function loadChromium() {
  const explicit = process.env.PLAYWRIGHT_MODULE;
  if (explicit) return (await import(explicit)).chromium;
  try {
    return (await import("playwright")).chromium;
  } catch {
    const cache = path.join(homedir(), ".npm", "_npx");
    for (const dir of readdirSync(cache)) {
      const entry = path.join(cache, dir, "node_modules", "playwright", "index.mjs");
      try {
        return (await import(entry)).chromium;
      } catch {
        // next candidate
      }
    }
    throw new Error("playwright not found — set PLAYWRIGHT_MODULE to its index.mjs");
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}
const log = (m) => process.stdout.write(`${m}\n`);

// ── database side ──────────────────────────────────────────────────────────
function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(url && key, "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (.env.local)");
  const host = new URL(url).hostname;
  assert(host === "127.0.0.1" || host === "localhost", `refusing to touch a non-local Supabase (${url})`);
  return createClient(url, key, { auth: { persistSession: false } });
}

async function prepareOrg(client) {
  const { data: org, error } = await client.from("orgs").select("id, name, offers_rentals, timezone").eq("handle", HANDLE).maybeSingle();
  if (error) throw error;
  assert(org, `no org with handle "${HANDLE}" — run npm run db:seed`);
  const patch = {};
  if (org.name !== ORG_NAME) patch.name = ORG_NAME;
  if (org.timezone !== "Europe/Warsaw") patch.timezone = "Europe/Warsaw";
  if (!org.offers_rentals) Object.assign(patch, { offers_rentals: true, offers_appointments: false });
  if (Object.keys(patch).length) {
    const { error: e } = await client.from("orgs").update(patch).eq("id", org.id);
    if (e) throw e;
    log(`   setup: org → "${ORG_NAME}", Spaces mode`);
  }
  const { error: planError } = await client
    .from("org_plan_overrides")
    .upsert({ org_id: org.id, plan: "team", expires_at: null, note: "landing screenshots", granted_by: "landing-shots.mjs" }, { onConflict: "org_id" });
  if (planError) throw planError;

  // Everything that isn't the studio's own set is a QA leftover: retired,
  // not deleted, so its bookings stay readable.
  const keep = SPACES.map((s) => s.name);
  const { data: all, error: allError } = await client.from("rental_offerings").select("id, name, active").eq("org_id", org.id);
  if (allError) throw allError;
  const stale = (all ?? []).filter((o) => o.active && !keep.includes(o.name)).map((o) => o.id);
  if (stale.length) {
    await client.from("rental_units").update({ active: false }).in("offering_id", stale);
    await client.from("rental_offerings").update({ active: false }).in("id", stale);
    log(`   setup: retired ${stale.length} leftover space(s)`);
  }
  return org.id;
}

/** Studio hours: 08:00–20:00 every day, on every space of the set. */
async function setHours(client, orgId) {
  const { data: rows, error } = await client.from("rental_offerings").select("id, name").eq("org_id", orgId).in("name", SPACES.map((s) => s.name));
  if (error) throw error;
  const ids = (rows ?? []).map((r) => r.id);
  const { error: delError } = await client.from("availability_rules").delete().in("rental_offering_id", ids);
  if (delError) throw delError;
  const inserts = ids.flatMap((id) => [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ org_id: orgId, rental_offering_id: id, staff_id: null, weekday, start_time: "08:00", end_time: "20:00" })));
  const { error: insError } = await client.from("availability_rules").insert(inserts);
  if (insError) throw insError;
  log(`   setup: hours 08:00–20:00 daily on ${ids.length} space(s)`);
}

async function clearWeekend(client, orgId) {
  const { data, error } = await client
    .from("bookings")
    .select("id")
    .eq("org_id", orgId)
    .gte("starts_at", `${addDays(WEEK, 5)}T00:00:00Z`)
    .lt("starts_at", `${addDays(WEEK, 7)}T00:00:00Z`)
    .in("status", ["confirmed", "pending", "pending_payment"]);
  if (error) throw error;
  const ids = (data ?? []).map((b) => b.id);
  if (ids.length) {
    const { error: e } = await client.from("bookings").update({ status: "cancelled_by_provider" }).in("id", ids);
    if (e) throw e;
    log(`   setup: cancelled ${ids.length} weekend booking(s)`);
  }
}

async function existingBookings(client, orgId) {
  const { data, error } = await client
    .from("bookings")
    .select("client_name, starts_at")
    .eq("org_id", orgId)
    .gte("starts_at", `${WEEK}T00:00:00Z`)
    .lt("starts_at", `${addDays(WEEK, 7)}T00:00:00Z`)
    .in("status", ["confirmed", "pending", "pending_payment"]);
  if (error) throw error;
  return new Set((data ?? []).map((b) => `${b.client_name}|${b.starts_at.slice(0, 10)}`));
}

// ── browser side ───────────────────────────────────────────────────────────
async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator("#email").fill(EMAIL);
  await page.locator("#password").fill(PASSWORD);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
}

async function spaceIds(page) {
  await page.goto(`${BASE}/rentals`, { waitUntil: "domcontentloaded" });
  await page.locator("main").waitFor();
  const links = await page.locator('a[href^="/rentals/"]').evaluateAll((as) => as.map((a) => [a.textContent.trim(), a.getAttribute("href")]));
  const ids = {};
  for (const s of SPACES) {
    const hit = links.find(([text]) => text.startsWith(s.name));
    if (hit) ids[s.key] = hit[1].split("/").pop();
  }
  return ids;
}

async function createSpace(page, s) {
  // The kind rides the URL; hourly is the form's default; a create lands
  // on the new space's page (qa-s6-compound.mjs has the same helper).
  await page.goto(`${BASE}/rentals/new${s.kind === "space" ? "" : `?kind=${s.kind}`}`, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="name"]').waitFor({ state: "visible" });
  await page.locator('input[name="name"]').fill(s.name);
  for (const room of s.components ?? []) {
    await page.locator("label").filter({ hasText: room }).locator('[role="checkbox"]').click();
  }
  await page.locator("#offering-price").fill(String(s.price));
  if (s.itemCount !== undefined) await page.locator("#offering-item-count").fill(String(s.itemCount));
  await page.getByRole("button", { name: "Create space" }).click();
  await page.waitForURL(/\/rentals\/[0-9a-f-]{36}$/, { timeout: 60_000 });
}

async function book(page, ids, b) {
  const day = addDays(WEEK, b.d);
  await page.goto(`${BASE}/${HANDLE}?lang=en&space=${ids[b.space]}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: new RegExp(`^${b.h} h`) }).first().click();
  const label = dayCellLabel.format(new Date(`${day}T00:00:00Z`));
  const cell = page.getByRole("option", { name: label });
  await page.locator('[role="listbox"] [role="option"]').first().waitFor({ state: "attached", timeout: 60_000 });
  for (let i = 0; i < 4 && (await cell.count()) === 0; i++) {
    await page.getByRole("button", { name: "Next month" }).click();
    await page.waitForTimeout(1200);
  }
  assert((await cell.count()) > 0, `no day cell for ${label}`);
  assert(await cell.first().isEnabled(), `${label} has no free time on ${b.space}`);
  await cell.first().click();
  const chip = page.getByRole("button", { name: new RegExp(`, ${b.time}$`) });
  assert((await chip.count()) > 0, `no ${b.time} slot on ${label} for ${b.space}`);
  await chip.first().click();
  await page.locator("#hourly-name").waitFor({ state: "visible" });
  if (b.lamps) {
    const more = page.locator('ul[aria-label="Equipment"] li').filter({ hasText: "Profoto" }).first().getByRole("button", { name: /^More: / });
    for (let i = 0; i < b.lamps; i++) await more.click();
  }
  await page.locator("#hourly-name").fill(b.name);
  await page.locator("#hourly-email").fill(emailFor(b.name));
  await page.getByRole("button", { name: /^(Confirm booking|Request to book)$/ }).click();
  const link = page.locator('a[href*="/booking/"]').first();
  const refused = page.locator('p[role="alert"]').first();
  for (let i = 0; i < 120; i++) {
    if ((await link.count()) > 0) return;
    if ((await refused.count()) > 0) {
      const why = (await refused.innerText()).trim();
      if (why) throw new Error(`refused: ${why}`);
    }
    await page.waitForTimeout(500);
  }
  throw new Error("no confirmation after 60s");
}

// ── main ───────────────────────────────────────────────────────────────────
const client = db();
log("── Setup");
const orgId = await prepareOrg(client);

const chromium = await loadChromium();
const browser = await chromium.launch();
const admin = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await admin.newPage();
await login(page);

log("── Spaces");
let ids = await spaceIds(page);
for (const s of SPACES) {
  if (ids[s.key]) continue;
  await createSpace(page, s);
  log(`   created ${s.name}`);
}
ids = await spaceIds(page);
for (const s of SPACES) assert(ids[s.key], `${s.name} missing after create`);
await setHours(client, orgId);

log("── Bookings");
await clearWeekend(client, orgId);
const have = await existingBookings(client, orgId);
const pub = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const pubPage = await pub.newPage();
for (const b of BOOKINGS) {
  const key = `${b.name}|${addDays(WEEK, b.d)}`;
  if (have.has(key)) continue;
  try {
    await book(pubPage, ids, b);
    log(`   booked ${b.name}, ${b.space}, ${addDays(WEEK, b.d)} ${b.time} (${b.h} h${b.lamps ? `, ${b.lamps} lamp` : ""})`);
  } catch (e) {
    log(`   skipped ${b.name} ${addDays(WEEK, b.d)} ${b.time}: ${e.message.split("\n")[0]}`);
  }
  // The public create RPC is throttled per org; pace the run.
  await pubPage.waitForTimeout(4000);
}

/** No dev overlay in the shots; the sidebar's sign-in line reads as the studio's. */
async function tidy(p) {
  await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await p.evaluate((email) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) if (n.textContent.trim() === email) n.textContent = "hello@studiohalo.pl";
  }, EMAIL);
}

log("── Screenshots");
mkdirSync(OUT, { recursive: true });
await page.goto(`${BASE}/bookings?week=${WEEK}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await tidy(page);
await page.screenshot({ path: path.join(OUT, "admin-week.png") });
log(`   ${OUT}/admin-week.png`);

const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const phonePage = await phone.newPage();
await phonePage.goto(`${BASE}/${HANDLE}?lang=en&space=${ids.roomA}`, { waitUntil: "networkidle" });
await phonePage.getByRole("button", { name: /^2 h/ }).first().click();
{
  // The booked week's Wednesday, two hours: the hero story's client taps
  // its 15:00 chip (hero-story.tsx), the slot the admin shot leaves open.
  const day = addDays(WEEK, 2);
  const label = dayCellLabel.format(new Date(`${day}T00:00:00Z`));
  const cell = phonePage.getByRole("option", { name: label });
  await phonePage.locator('[role="listbox"] [role="option"]').first().waitFor({ state: "attached", timeout: 60_000 });
  for (let i = 0; i < 4 && (await cell.count()) === 0; i++) {
    await phonePage.getByRole("button", { name: "Next month" }).click();
    await phonePage.waitForTimeout(1200);
  }
  await cell.first().click();
  await phonePage.waitForTimeout(1500);
}
await tidy(phonePage);
await phonePage.screenshot({ path: path.join(OUT, "public-phone.png") });
log(`   ${OUT}/public-phone.png`);

await browser.close();
log("done");
