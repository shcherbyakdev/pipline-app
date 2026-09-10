#!/usr/bin/env node
/**
 * Booking phone (0086) browser QA on the local demo org — dev database only.
 *   npm run dev            # http://localhost:3000 (never 127.0.0.1)
 *   node scripts/qa-booking-phone.mjs
 * Flips Settings → Business → Client details through the UI, books Room A
 * phone-only and with both, checks the dialog + directory, restores Email.
 */
import { readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { createClient } from "@supabase/supabase-js";
try { loadEnvFile(".env.local"); } catch {}

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const HANDLE = "demo-studio";
const EMAIL = "demo@rolloutos.local";
const PASSWORD = "Password123!";
const TAG = Date.now().toString(36).slice(-5).toUpperCase();
const OUT = process.env.QA_ARTIFACTS ?? tmpdir();

async function loadChromium() {
  const explicit = process.env.PLAYWRIGHT_MODULE;
  if (explicit) return (await import(explicit)).chromium;
  try { return (await import("playwright")).chromium; } catch {}
  const cache = path.join(homedir(), ".npm", "_npx");
  for (const dir of readdirSync(cache)) {
    try { return (await import(path.join(cache, dir, "node_modules", "playwright", "index.mjs"))).chromium; } catch {}
  }
  throw new Error("playwright not found");
}
const results = [];
const assert = (c, m) => { if (!c) throw new Error(m); };
async function step(n, title, fn) {
  process.stdout.write(`\n── Step ${n}: ${title}\n`);
  try { const d = await fn(); results.push({ n, ok: true }); console.log(`   ✓ ${d ?? "ok"}`); }
  catch (e) { results.push({ n, ok: false }); console.log(`   ✗ ${e?.message ?? e}`); await page.screenshot({ path: path.join(OUT, `phone-fail-${n}.png`), fullPage: true }).catch(() => {}); }
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: org } = await db.from("orgs").select("id, client_contact").eq("handle", HANDLE).single();
const contactOf = async () => (await db.from("orgs").select("client_contact").eq("id", org.id).single()).data.client_contact;
const roomA = (await db.from("rental_offerings").select("id").eq("org_id", org.id).eq("name", "Room A").single()).data.id;

const ORG_TZ = "Europe/Berlin";
const dayKey = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: ORG_TZ });
const dayCellLabel = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
function weekdayOnOrAfter(daysAhead) {
  let iso = dayKey.format(new Date(Date.now() + daysAhead * 86_400_000));
  while ([0, 6].includes(new Date(`${iso}T00:00:00Z`).getUTCDay())) iso = new Date(new Date(`${iso}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
  return iso;
}
const DAY = weekdayOnOrAfter(9);

const chromium = await loadChromium();
const browser = await chromium.launch({ headless: process.env.QA_HEADED !== "1" });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-GB", timezoneId: ORG_TZ,
  extraHTTPHeaders: { "x-forwarded-for": `10.78.${(parseInt(TAG, 36) >> 8) & 255}.${parseInt(TAG, 36) & 255}` } });
context.setDefaultTimeout(30_000);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

async function login() {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator("#email").fill(EMAIL);
  await page.locator("#password").fill(PASSWORD);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
}
async function openSlot(time) {
  await page.goto(`${BASE}/${HANDLE}?lang=en&space=${roomA}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^1 h/ }).first().click();
  const label = dayCellLabel.format(new Date(`${DAY}T00:00:00Z`));
  const cell = page.getByRole("option", { name: label });
  await page.locator('[role="listbox"] [role="option"]').first().waitFor({ state: "attached", timeout: 60_000 });
  for (let i = 0; i < 3 && (await cell.count()) === 0; i++) { await page.getByRole("button", { name: "Next month" }).click(); await page.waitForTimeout(1500); }
  assert((await cell.count()) > 0, `no day cell for ${label}`);
  await cell.first().click();
  const chip = page.getByRole("button", { name: new RegExp(`, ${time}$`) });
  assert((await chip.count()) > 0, `no ${time} slot on ${label}`);
  await chip.first().click();
  await page.locator("#hourly-name").waitFor({ state: "visible" });
}
const widgetForm = () => page.locator("form").filter({ has: page.locator("#hourly-name") });
async function confirm() {
  await page.getByRole("button", { name: /^(Confirm booking|Request to book)$/ }).click();
  const link = page.locator('a[href*="/booking/"]').first();
  const refused = page.locator('p[role="alert"]').first();
  for (let i = 0; i < 120; i++) {
    if ((await link.count()) > 0) return (await link.getAttribute("href")).match(/\/booking\/([^/?]+)/)[1];
    if ((await refused.count()) > 0) { const why = (await refused.innerText()).trim(); if (why) throw new Error(`refused: ${why}`); }
    await page.waitForTimeout(250);
  }
  throw new Error("no confirmation");
}
const radio = (value) => page.locator(`input[name="client-contact"][value="${value}"]`);
const pick = async (value) => { await radio(value).check({ force: true }); await page.getByText("Saved").first().waitFor({ timeout: 15_000 }); await page.waitForTimeout(800); };

const NAME = `PhoneQA ${TAG}`;
const DIGITS = String(600000000 + (parseInt(TAG, 36) % 99999999)).slice(0, 9);
const PHONE = `+48 ${DIGITS.slice(0, 3)}-${DIGITS.slice(3, 6)} ${DIGITS.slice(6)}`;
const STORED = `+48${DIGITS}`;
let bookingId;
try {
  await login();

  await step(1, "Settings → Business shows the Client details card, defaulting to Email", async () => {
    await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
    await page.locator("div").filter({ hasText: /^Client details$/ }).first().waitFor();
    assert(await radio("email").isChecked(), "Email not checked");
    await page.screenshot({ path: path.join(OUT, "phone-settings.png"), fullPage: true });
    return "card visible";
  });

  await step(2, "picking Phone saves (toast + row)", async () => {
    await pick("phone");
    assert((await contactOf()) === "phone", `row says ${await contactOf()}`);
    return "orgs.client_contact = phone";
  });

  await step(3, "public form: phone only — no email field, phone required", async () => {
    await openSlot("10:00");
    const f = widgetForm();
    assert((await f.locator("#hourly-email").count()) === 0, "email field rendered");
    assert(await f.locator("#hourly-phone").isVisible(), "no phone field");
    assert(await f.locator("#hourly-phone").evaluate((el) => el.required), "phone not required");
    await page.screenshot({ path: path.join(OUT, "phone-form-phone.png") });
    return "Name + Phone + Note";
  });

  await step(4, "a phone-only booking lands with the phone, no mail promised", async () => {
    await widgetForm().locator("#hourly-name").fill(NAME);
    await widgetForm().locator("#hourly-phone").fill(PHONE);
    const token = await confirm();
    const body = await page.locator("text=Keep the links below").first().innerText().catch(() => "");
    assert(body.includes("Keep the links below"), "confirmation still promises an email");
    assert(!(await page.getByText("confirmation email").count()), "email copy present");
    await page.screenshot({ path: path.join(OUT, "phone-confirmed.png") });
    const { data } = await db.from("bookings").select("id, client_email, client_phone, client_id").eq("client_name", NAME).single();
    bookingId = data.id;
    assert(data.client_phone === STORED && data.client_email === null, JSON.stringify(data));
    const { data: c } = await db.from("clients").select("phone, email").eq("id", data.client_id).single();
    assert(c.phone === STORED && c.email === null, JSON.stringify(c));
    return `booking ${bookingId.slice(0, 8)} phone stored + client keyed by phone (token ${token.slice(0, 6)}…)`;
  });

  await step(5, "admin: the booking dialog shows the phone", async () => {
    await page.goto(`${BASE}/bookings?view=day&date=${DAY}`, { waitUntil: "domcontentloaded" });
    await page.getByText(NAME, { exact: false }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    const text = await dialog.innerText();
    assert(text.includes(STORED), `dialog reads:\n${text}`);
    await page.screenshot({ path: path.join(OUT, "phone-dialog.png") });
    await page.keyboard.press("Escape");
    return "phone in the contact line";
  });

  await step(6, "clients directory lists the phone", async () => {
    await page.goto(`${BASE}/clients`, { waitUntil: "domcontentloaded" });
    const row = page.locator("a").filter({ hasText: NAME }).first();
    await row.waitFor();
    assert((await row.innerText()).includes(STORED), await row.innerText());
    return "directory row carries the phone";
  });

  await step(7, "Both: two required fields on the public form", async () => {
    await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
    await pick("both");
    assert((await contactOf()) === "both", `row says ${await contactOf()}`);
    await openSlot("13:00");
    const f = widgetForm();
    assert(await f.locator("#hourly-email").evaluate((el) => el.required), "email not required");
    assert(await f.locator("#hourly-phone").evaluate((el) => el.required), "phone not required");
    await page.screenshot({ path: path.join(OUT, "phone-form-both.png") });
    await f.locator("#hourly-name").fill(`${NAME} both`);
    await f.locator("#hourly-email").fill(`phoneqa-${TAG.toLowerCase()}@example.com`);
    await f.locator("#hourly-phone").fill("500 600 700");
    await confirm();
    const { data } = await db.from("bookings").select("client_email, client_phone").eq("client_name", `${NAME} both`).single();
    assert(data.client_phone === "500600700" && data.client_email === `phoneqa-${TAG.toLowerCase()}@example.com`, JSON.stringify(data));
    return "both stored";
  });

  await step(8, "back to Email: the phone field is gone again", async () => {
    await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
    await pick("email");
    assert((await contactOf()) === "email", `row says ${await contactOf()}`);
    await openSlot("15:00");
    assert((await widgetForm().locator("#hourly-phone").count()) === 0, "phone field still rendered");
    assert(await widgetForm().locator("#hourly-email").evaluate((el) => el.required), "email not required");
    return "email-only form";
  });
} finally {
  await db.from("orgs").update({ client_contact: "email" }).eq("id", org.id);
  // The QA bookings: cancelled so the demo calendar stays as it was.
  await db.from("bookings").update({ status: "cancelled_by_provider" }).ilike("client_name", `${NAME}%`);
  await browser.close();
}
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed; page errors: ${errors.length}`);
if (errors.length) console.log(errors.slice(0, 5).join("\n"));
process.exit(results.every((r) => r.ok) && errors.length === 0 ? 0 : 1);
