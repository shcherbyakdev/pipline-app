#!/usr/bin/env node
/**
 * Timeline v3 browser QA — part 2: hourly chip move + undo, non-movable bars, text contrast light/dark, 1024/768/390 widths.
 *
 *   npm run dev                                  # on http://localhost:3000 (never 127.0.0.1)
 *   docker exec -i supabase_db_pipline-app psql -U postgres -v ON_ERROR_STOP=1 < scripts/seed-timeline-qa.sql
 *   node scripts/qa-timeline-2.mjs               # PASS/FAIL per step, exits non-zero on any failure
 *
 * Needs a signed-in storage state at $QA_STATE (defaults to .playwright-mcp/tl-state.json; created by
 * logging in once as demo@rolloutos.local / Password123!), the local Supabase container, and a
 * Playwright + Chrome for Testing install ($PLAYWRIGHT_MODULE, $CHROME_PATH override the paths below).
 * Moves it makes are undone or reset by SQL; dev database only.
 */
import path from "node:path";
import { execSync } from "node:child_process";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const BASE = "http://localhost:3000";
const OUT = process.env.QA_ARTIFACTS ?? ".playwright-mcp";
const STATE = process.env.QA_STATE ?? path.join(OUT, "tl-state.json");
const sql = (q) => execSync(`docker exec supabase_db_pipline-app psql -U postgres -At -c "${q.replace(/"/g, '\\"')}"`).toString().trim();
const results = [];
const assert = (c, m) => { if (!c) throw new Error(m); };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
let page;
async function step(name, fn) {
  try { await fn(); results.push(["PASS", name]); console.log("PASS", name); }
  catch (e) { results.push(["FAIL", name]); console.log("FAIL", name, "→", String(e).split("\n")[0]); await page?.screenshot({ path: path.join(OUT, `fail2-${name.replace(/\W+/g, "-")}.png`) }); }
  finally { await page?.mouse.up().catch(() => {}); }
}
async function fresh(opts = {}) {
  const ctx = await browser.newContext({ storageState: STATE, viewport: { width: 1440, height: 900 }, locale: "en-GB", timezoneId: "Europe/Warsaw", ...opts });
  if (opts.colorScheme === "dark") await ctx.addInitScript(() => { try { localStorage.setItem("theme", "dark"); } catch {} });
  page = await ctx.newPage();
  return page;
}
const open = async (q) => { await page.goto(`${BASE}/bookings?view=timeline${q}`, { waitUntil: "domcontentloaded" }); await page.waitForSelector("[data-tl-scroller]"); await page.waitForTimeout(900); };
const miaId = () => sql(`select id from bookings where client_name='Mia Novak' and rental_offering_id is not null and status='confirmed'`);

await fresh();
await step("hourly chip drags to the next day keeping its time", async () => {
  await open("&days=14&from=2026-09-28");
  const chip = page.locator(`#tl-stay-${miaId()}`);
  const box = await chip.boundingBox();
  const cw = await page.locator("[data-tl-cell]").first().evaluate((el) => el.getBoundingClientRect().width);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 8, box.y + box.height / 2, { steps: 2 });
  await page.mouse.move(box.x + box.width / 2 - 5 * cw, box.y + box.height / 2, { steps: 8 });
  await page.waitForTimeout(150);
  const ghost = await page.locator("[data-tl-unit] .pointer-events-none.border-2").first().textContent().catch(() => "");
  assert(ghost.includes("30 Sept") && ghost.includes("10:00"), `ghost=${ghost}`);
  await page.mouse.up();
  await page.getByText("Booking moved").first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200);
  const start = sql(`select starts_at at time zone 'Europe/Warsaw' from bookings where client_name='Mia Novak' and status='confirmed' and rental_offering_id is not null order by created_at desc limit 1`);
  assert(start === "2026-09-30 10:00:00", `db=${start}`);
  await page.getByRole("button", { name: "Undo" }).click();
  await page.waitForTimeout(4000);
  console.log("   toasts:", await page.locator("[data-sonner-toast]").allTextContents());
  const back = sql(`select starts_at at time zone 'Europe/Warsaw' from bookings where client_name='Mia Novak' and status='confirmed' and rental_offering_id is not null order by created_at desc limit 1`);
  assert(back === "2026-10-05 10:00:00", `db after undo=${back}`);
});

await step("a request and a hold are not draggable; the card says why", async () => {
  await open("&days=14&from=2026-09-14");
  const hold = sql(`select id from bookings where client_name='TLQA Tomasz Kot'`);
  const bar = page.locator(`#tl-stay-${hold}`);
  await bar.focus();
  await page.waitForTimeout(500);
  const tip = await page.locator('[data-slot="tooltip-content"]').first().textContent();
  assert(tip.includes("Waiting for payment"), `tip=${tip}`);
  assert(tip.includes("Reserved until") || tip.includes("until"), `no hold expiry: ${tip}`);
  const box = await bar.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 6 });
  const ghosts = await page.locator("[data-tl-unit] .pointer-events-none.border-2").count();
  assert(ghosts === 0, `ghosts=${ghosts}`);
  await page.mouse.up();
});

await step("bar text contrast in dark ≥ 4.5:1 (name) and ≥ 3:1 (length)", async () => {
  await page.context().close();
  await fresh({ colorScheme: "dark" });
  await open("&days=14&from=2026-09-14");
  const kasia = sql(`select id from bookings where client_name='TLQA Kasia Mazur' and status='confirmed'`);
  const r = await page.locator(`#tl-stay-${kasia}`).evaluate((el) => {
    const lum = (c) => { const srgb = c.startsWith("color(srgb"); const [r, g, b] = c.replace(/^[a-z(]+srgb/, "").match(/\d+(\.\d+)?/g).map(Number).slice(0, 3).map((v) => { if (!srgb) v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
    const bg = getComputedStyle(el).backgroundColor;
    const name = el.querySelector(".font-medium");
    const len = el.querySelector(".text-muted-foreground");
    return { bg, name: ratio(getComputedStyle(name).color, bg), len: len ? ratio(getComputedStyle(len).color, bg) : null };
  });
  console.log("   dark contrast", JSON.stringify(r));
  assert(r.name >= 4.5, `name ${r.name}`);
  assert(r.len === null || r.len >= 3, `length ${r.len}`);
});

await step("light: bar text contrast", async () => {
  await page.context().close();
  await fresh();
  await open("&days=14&from=2026-09-14");
  const kasia = sql(`select id from bookings where client_name='TLQA Kasia Mazur' and status='confirmed'`);
  const r = await page.locator(`#tl-stay-${kasia}`).evaluate((el) => {
    const lum = (c) => { const srgb = c.startsWith("color(srgb"); const [r, g, b] = c.replace(/^[a-z(]+srgb/, "").match(/\d+(\.\d+)?/g).map(Number).slice(0, 3).map((v) => { if (!srgb) v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
    const bg = getComputedStyle(el).backgroundColor;
    const name = el.querySelector(".font-medium");
    const len = el.querySelector(".text-muted-foreground");
    return { bg, name: ratio(getComputedStyle(name).color, bg), len: len ? ratio(getComputedStyle(len).color, bg) : null };
  });
  console.log("   light contrast", JSON.stringify(r));
  assert(r.name >= 4.5, `name ${r.name}`);
  assert(r.len === null || r.len >= 3, `length ${r.len}`);
});

for (const [w, h] of [[1024, 768], [768, 1024], [390, 844]]) {
  await step(`renders at ${w}px with native scroll and no page overflow`, async () => {
    await page.context().close();
    await fresh({ viewport: { width: w, height: h } });
    await open("&days=14&from=2026-09-07");
    await page.screenshot({ path: path.join(OUT, `tl-v3-${w}.png`) });
    const m = await page.evaluate(() => {
      const el = document.querySelector("[data-tl-scroller]");
      return { docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1, scrollW: el.scrollWidth, clientW: el.clientWidth, cell: document.querySelector("[data-tl-cell]").getBoundingClientRect().width, rail: document.querySelector('[role="rowheader"]').getBoundingClientRect().width };
    });
    console.log("   ", w, JSON.stringify(m));
    assert(!m.docOverflow, "document scrolls sideways");
    assert(m.cell >= 14, "cells too narrow");
  });
}

await browser.close();
const fails = results.filter(([s]) => s === "FAIL").length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
