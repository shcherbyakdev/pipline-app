#!/usr/bin/env node
/**
 * Plan notices browser QA on the local demo org — dev database only.
 *   npm run dev            # http://localhost:3000 (never 127.0.0.1)
 *   node scripts/qa-plan-notice.mjs
 * The demo org is Spaces + Pro with 10 active units, so the banner is over
 * its cap: it must name UNITS (never "bookable resources"), close for good,
 * and come back when the number it names changes.
 */
import { readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { createClient } from "@supabase/supabase-js";
try { loadEnvFile(".env.local"); } catch {}

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = "demo@rolloutos.local";
const PASSWORD = "Password123!";
const OUT = process.env.QA_ARTIFACTS ?? tmpdir();

async function loadChromium() {
  try { return (await import("playwright")).chromium; } catch {}
  const cache = path.join(homedir(), ".npm", "_npx");
  for (const dir of readdirSync(cache)) {
    try { return (await import(path.join(cache, dir, "node_modules", "playwright", "index.mjs"))).chromium; } catch {}
  }
  throw new Error("playwright not found");
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: org } = await db.from("orgs").select("id").eq("handle", "demo-studio").single();
const { data: units } = await db.from("rental_units").select("id").eq("org_id", org.id).eq("active", true).order("id");

const results = [];
const assert = (c, m) => { if (!c) throw new Error(m); };
async function step(n, title, fn) {
  process.stdout.write(`\n── Step ${n}: ${title}\n`);
  try { const d = await fn(); results.push(true); console.log(`   ✓ ${d ?? "ok"}`); }
  catch (e) { results.push(false); console.log(`   ✗ ${e?.message ?? e}`); await page.screenshot({ path: path.join(OUT, `plan-notice-fail-${n}.png`), fullPage: true }).catch(() => {}); }
}

const chromium = await loadChromium();
const browser = await chromium.launch({ headless: process.env.QA_HEADED !== "1" });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-GB" });
context.setDefaultTimeout(30_000);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const notice = () => page.locator('[role="status"]').filter({ hasText: /booking page — your plan covers/ });

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.locator("#email").fill(EMAIL);
await page.locator("#password").fill(PASSWORD);
await page.locator('form button[type="submit"]').first().click();
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });

await step(1, "the banner names units, not resources", async () => {
  await page.goto(`${BASE}/bookings`, { waitUntil: "domcontentloaded" });
  await notice().first().waitFor();
  const text = (await notice().first().innerText()).replace(/\s+/g, " ").trim();
  assert(/units aren't on your booking page/.test(text), `unexpected copy: ${text}`);
  assert(!/resource/i.test(text), `still says "resource": ${text}`);
  await page.screenshot({ path: path.join(OUT, "plan-notice-banner.png") });
  return text;
});

await step(2, "close hides it, and it stays gone across loads", async () => {
  // Await the action's own POST: navigating while it is in flight would
  // abort the cookie write, and the notice would be back — as a person
  // clicking X and moving on immediately would also find.
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && r.status() === 200),
    notice().first().getByRole("button", { name: "Dismiss" }).click(),
  ]);
  await notice().first().waitFor({ state: "detached" });
  await page.goto(`${BASE}/overview`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  assert((await notice().count()) === 0, "the notice came back after a reload");
  return "gone on /overview too";
});

await step(3, "it returns when the number it names changes", async () => {
  await db.from("rental_units").update({ active: false }).eq("id", units.at(-1).id);
  try {
    await page.goto(`${BASE}/bookings`, { waitUntil: "domcontentloaded" });
    await notice().first().waitFor();
    const text = (await notice().first().innerText()).replace(/\s+/g, " ").trim();
    assert(/4 units/.test(text), `expected 4 hidden units: ${text}`);
    return text;
  } finally {
    await db.from("rental_units").update({ active: true }).eq("id", units.at(-1).id);
  }
});

await step(4, "no page errors", async () => {
  assert(errors.length === 0, errors.join(" | "));
  return "clean console";
});

await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} steps passed · artifacts in ${OUT}`);
process.exit(results.every(Boolean) ? 0 : 1);
