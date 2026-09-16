#!/usr/bin/env node
/**
 * Design once, share once (spec 2026-09-16) browser QA against a local dev
 * server: the studio publishes only page things and never traps, Settings
 * holds the org's address and brand, the embed page is a generator on the
 * booking page's look, and `?theme=` pins the public embed.
 *
 *   npm run dev                      # keep it on http://localhost:3000
 *   node scripts/qa-design-once.mjs  # prints PASS n/8, exits non-zero on any failure
 *
 * Env: BASE_URL (default http://localhost:3000 — never 127.0.0.1), PLAYWRIGHT_MODULE,
 * QA_HEADED=1, QA_SHOTS=<dir> to keep desktop + phone screenshots. Reads the
 * local demo org only; changes nothing (the admin runs in English via the
 * NEXT_LOCALE cookie on this browser context alone).
 */
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const HANDLE = "demo-studio";
const SHOTS = process.env.QA_SHOTS;

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
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }); };

const chromium = await loadChromium();
const browser = await chromium.launch({ headless: !process.env.QA_HEADED });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-GB" });
await ctx.addCookies([{ name: "NEXT_LOCALE", value: "en", url: BASE }]);
const page = await ctx.newPage();
page.setDefaultTimeout(30_000);
// The studio warns before leaving an unpublished draft; QA leaves anyway.
page.on("dialog", (d) => d.accept());

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.locator("#email").fill("demo@rolloutos.local");
await page.locator("#password").fill("Password123!");
await page.locator('form button[type="submit"]').first().click();
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });

await step(1, "studio: closing the starter keeps you in the studio", async () => {
  await page.goto(`${BASE}/booking-page`, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Sections" }).waitFor();
  // The starter mounts after hydration, a beat after the tabs: give it that beat.
  await page.getByRole("dialog").waitFor({ timeout: 4000 }).catch(() => {});
  if (!(await page.getByRole("dialog").count())) return "no starter on this org's page (already set up) — nothing to close";
  assert((await page.getByRole("dialog").getByRole("button", { name: "Leave for now" }).count()) === 0, "Leave for now is still offered");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert(new URL(page.url()).pathname === "/booking-page", `navigated to ${page.url()}`);
  return "Esc closed it; still on /booking-page";
});

await step(2, "studio: Sections · Style, Copy link beside Publish", async () => {
  await page.getByRole("tab", { name: "Sections" }).waitFor();
  await page.getByRole("tab", { name: "Style" }).waitFor();
  assert((await page.getByRole("tab", { name: "Settings" }).count()) === 0, "a Settings tab is still there");
  await page.getByRole("button", { name: "Copy link — Booking page" }).waitFor();
  await shot(page, "studio-sections");
  return "tabs Sections · Style; Copy link in the header";
});

await step(3, "studio › Style: only what publishes — page layout and widget style", async () => {
  await page.getByRole("tab", { name: "Style" }).click();
  await page.getByText("Widget style", { exact: true }).waitFor();
  assert((await page.locator("#scheduling-handle").count()) === 0, "the address field is still in the studio");
  assert((await page.locator("#branding-logo").count()) === 0, "the logo upload is still in the studio");
  assert((await page.getByText(/has its own/).count()) === 0, "a cross-page 'has its own' hint remains");
  await shot(page, "studio-style");
  return "Page layout + Widget style; no address, no logo, no cross-page hint";
});

await step(4, "Settings › Business holds the address and the brand", async () => {
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
  await page.locator("#scheduling-handle").waitFor();
  await page.locator("#branding-accent").waitFor();
  await page.getByText("Brand", { exact: true }).waitFor();
  await shot(page, "settings");
  return "address, timezone, currency, language, logo and accent on Settings";
});

await step(5, "embed page: no tabs, no style editor, a Theme parameter", async () => {
  await page.goto(`${BASE}/embed`, { waitUntil: "domcontentloaded" });
  await page.locator("#embed-theme").waitFor();
  assert((await page.getByRole("tab").count()) === 0, "tabs are still there");
  assert((await page.getByRole("button", { name: "Save" }).count()) === 0, "a Save button is still there");
  await page.getByRole("button", { name: "Copy page link" }).waitFor();
  await shot(page, "embed");
  return "Code only; Theme select; Copy page link";
});

await step(6, "embed page: picking Dark writes ?theme=dark into the snippet and darkens the preview", async () => {
  await page.locator("#embed-theme").selectOption("dark");
  await page.waitForFunction(() => document.querySelector("pre")?.innerText.includes("theme=dark"));
  await page.locator(".wt-dark").first().waitFor();
  await page.locator("#embed-theme").selectOption("");
  await page.waitForFunction(() => !document.querySelector("pre")?.innerText.includes("theme="));
  return "snippet ?theme=dark, preview .wt-dark; back to the page's own theme";
});

await step(7, "public embed: ?theme=dark pins dark over the page's look", async () => {
  const pub = await ctx.newPage();
  await pub.goto(`${BASE}/embed/${HANDLE}?theme=dark&lang=en`, { waitUntil: "domcontentloaded" });
  await pub.locator(".wt-dark").first().waitFor();
  await pub.goto(`${BASE}/embed/${HANDLE}?theme=purple&lang=en`, { waitUntil: "domcontentloaded" });
  await pub.locator('[class*="wt-"]').first().waitFor();
  assert((await pub.locator(".wt-purple").count()) === 0, "an unknown theme leaked into the class");
  await pub.close();
  return "dark pinned; an unknown value keeps the page's theme";
});

await step(8, "phone width: the preview toolbar wraps instead of overflowing", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ["/booking-page", "/embed"]) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    if (route === "/booking-page") {
      // Same beat as step 1: the starter mounts after hydration.
      if (await page.getByRole("dialog").waitFor({ timeout: 4000 }).then(() => true, () => false)) {
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").waitFor({ state: "detached" });
      }
    }
    const device = page.getByRole("radiogroup", { name: "Device" }).or(page.locator('[aria-label="Device"]')).first();
    await device.waitFor();
    const box = await device.boundingBox();
    assert(box && box.x + box.width <= 390, `${route}: the device toggle ends at ${box ? Math.round(box.x + box.width) : "?"}px`);
    await shot(page, `${route.slice(1)}-phone`);
  }
  return "device toggle inside 390px on both pages";
});

await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\nPASS ${passed}/${results.length}`);
process.exit(passed === results.length ? 0 : 1);
