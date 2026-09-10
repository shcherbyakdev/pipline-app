#!/usr/bin/env node
/**
 * Settings page browser QA on the local demo org — dev database only.
 *   npm run dev            # http://localhost:3000 (never 127.0.0.1)
 *   node scripts/qa-settings.mjs
 * Every preference is a dropdown at the right edge of its row and saves on
 * pick. The demo org sells spaces and has active units, so "What you offer"
 * is locked to a plain label. Client details is put back where it was.
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
const { data: org } = await db.from("orgs").select("id, client_contact").eq("handle", "demo-studio").single();
const originalContact = org.client_contact;

const results = [];
const assert = (c, m) => { if (!c) throw new Error(m); };
async function step(n, title, fn) {
  process.stdout.write(`\n── Step ${n}: ${title}\n`);
  try { const d = await fn(); results.push(true); console.log(`   ✓ ${d ?? "ok"}`); }
  catch (e) { results.push(false); console.log(`   ✗ ${e?.message ?? e}`); await page.screenshot({ path: path.join(OUT, `settings-fail-${n}.png`), fullPage: true }).catch(() => {}); }
}

const chromium = await loadChromium();
const browser = await chromium.launch({ headless: process.env.QA_HEADED !== "1" });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-GB" });
context.setDefaultTimeout(30_000);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

/** The dropdown trigger of the row whose heading is `label`. */
const trigger = (label) => page.getByRole("button", { name: label, exact: true });
async function pick(label, option) {
  await trigger(label).click();
  // A menu item's name carries its blurb too, so match the label at the start.
  await page.getByRole("menuitem", { name: new RegExp(`^${option}`) }).first().click();
  await closeMenu();
}
/** Base UI keeps the popup mounted through its close animation. */
async function openMenu(label) {
  await trigger(label).click();
  await page.getByRole("menu").waitFor();
  await page.waitForTimeout(250);
  return page.getByRole("menuitem").allInnerTexts();
}
/** Base UI keeps the popup mounted through its close animation. */
async function closeMenu() {
  await page.getByRole("menu").waitFor({ state: "hidden" }).catch(() => {});
  await page.waitForTimeout(300);
}

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.locator("#email").fill(EMAIL);
await page.locator("#password").fill(PASSWORD);
await page.locator('form button[type="submit"]').first().click();
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });

await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
await page.getByRole("heading", { name: "Interface" }).waitFor();

await step(1, "two groups, four rows, every control a dropdown", async () => {
  const groups = await page.locator("main section > h2").allInnerTexts();
  assert(groups.join("|") === "Interface|Business", `groups: ${groups.join("|")}`);
  for (const row of ["Interface theme", "Interface language", "Client details"]) {
    assert(await trigger(row).isVisible(), `no dropdown for ${row}`);
  }
  await page.screenshot({ path: path.join(OUT, "settings-light.png"), fullPage: true });
  return "Interface (theme, language) + Business (what you offer, client details)";
});

await step(2, "what you offer is locked to a label, no control", async () => {
  const row = page.locator("main section", { hasText: "Business" }).locator("div", { hasText: "What you offer" }).first();
  assert(await row.getByText("Spaces", { exact: true }).isVisible(), "locked label missing");
  assert((await trigger("What you offer").count()) === 0, "locked row still offers a dropdown");
  return "Spaces, with the deactivate-first line";
});

await step(3, "theme dropdown flips the app to dark", async () => {
  assert((await trigger("Interface theme").innerText()).includes("Light"), "trigger does not name Light");
  await pick("Interface theme", "Dark");
  const cls = await page.locator("html").getAttribute("class");
  assert(cls.includes("dark"), `html class: ${cls}`);
  assert((await trigger("Interface theme").innerText()).includes("Dark"), "trigger did not follow");
  await page.screenshot({ path: path.join(OUT, "settings-dark.png"), fullPage: true });
  await pick("Interface theme", "Light");
  return "dark applied and named, then back to light";
});

await step(4, "the theme survives a reload without a hydration error", async () => {
  await pick("Interface theme", "Dark");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
  assert((await trigger("Interface theme").innerText()).includes("Dark"), "trigger forgot the theme");
  assert(errors.length === 0, `page errors: ${errors.join(" | ")}`);
  await pick("Interface theme", "Light");
  return "still Dark after reload, no console errors";
});

await step(5, "language dropdown offers all three, in their own names", async () => {
  const items = await openMenu("Interface language");
  assert(items.join("|") === "English|Українська|Polski", `items: ${items.join("|")}`);
  await page.keyboard.press("Escape");
  await closeMenu();
  return items.join(", ");
});

await step(6, "client details saves on pick and holds through a reload", async () => {
  const hints = await openMenu("Client details");
  assert(hints.some((h) => h.includes("Confirmation and reminder emails")), `menu read as: ${JSON.stringify(hints)}`);
  await page.screenshot({ path: path.join(OUT, "settings-menu.png") });
  await page.keyboard.press("Escape");
  await closeMenu();
  const target = originalContact === "phone" ? "Email" : "Phone";
  await pick("Client details", target);
  await page.getByText("Saved", { exact: true }).first().waitFor({ timeout: 10_000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  assert((await trigger("Client details").innerText()).includes(target), "the pick did not stick");
  return `switched to ${target}, toast shown, still ${target} after reload`;
});

await db.from("orgs").update({ client_contact: originalContact }).eq("id", org.id);
console.log(`\nrestored client_contact = ${originalContact}`);
console.log(`\n${results.filter(Boolean).length}/${results.length} steps passed · shots in ${OUT}`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
