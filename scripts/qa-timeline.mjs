#!/usr/bin/env node
/**
 * Timeline v3 browser QA — part 1: search, drag-to-create, move/undo, refused drop, resize, keyboard, scroll commit, header pan, collapse, go-to-date, day links, conflicts chip.
 *
 *   npm run dev                                  # on http://localhost:3000 (never 127.0.0.1)
 *   docker exec -i supabase_db_pipline-app psql -U postgres -v ON_ERROR_STOP=1 < scripts/seed-timeline-qa.sql
 *   node scripts/qa-timeline.mjs               # PASS/FAIL per step, exits non-zero on any failure
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
const U103 = "aae5adc0-e02f-4120-aa2b-d327480dbf83";
const U102 = "676be31b-d169-490b-b935-926aa5b0e1e3";
const sql = (q) => execSync(`docker exec supabase_db_pipline-app psql -U postgres -At -c "${q.replace(/"/g, '\\"')}"`).toString().trim();

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(["PASS", name]); console.log("PASS", name); }
  catch (e) { results.push(["FAIL", name]); console.log("FAIL", name, "→", String(e).split("\n")[0]); await page.screenshot({ path: path.join(OUT, `fail-${name.replace(/\W+/g, "-")}.png`) }); }
  finally { await page.mouse.up().catch(() => {}); }
}
const kasiaId = () => sql(`select id from bookings where client_name='TLQA Kasia Mazur' and status='confirmed'`);
const assert = (c, m) => { if (!c) throw new Error(m); };

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
const ctx = await browser.newContext({ storageState: STATE, viewport: { width: 1440, height: 900 }, locale: "en-GB", timezoneId: "Europe/Warsaw" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("script tag")) errors.push(m.text()); });

const open = async (q) => { await page.goto(`${BASE}/bookings?view=timeline${q}`, { waitUntil: "domcontentloaded" }); await page.waitForSelector("[data-tl-scroller]"); await page.waitForTimeout(800); };
const cell = (unit, idx) => page.locator(`[data-tl-cell="${unit}:${idx}"]`);
const scroller = () => page.locator("[data-tl-scroller]");
const cellPx = async () => (await page.locator("[data-tl-cell]").first().evaluate((el) => el.getBoundingClientRect().width));
const dayIdx = (d) => { // index in the buffer for ?days=14&from=2026-09-07 → buffer from 2026-08-24
  const from = Date.UTC(2026, 7, 24); return Math.round((Date.parse(`${d}T00:00:00Z`) - from) / 86400000); };

await open("&days=14&from=2026-09-07");

await step("search counts and Enter focuses the first match", async () => {
  await page.getByPlaceholder("Find a client…").fill("kasia");
  await expect_text(page.getByText("1 match"));
  await page.getByPlaceholder("Find a client…").press("Enter");
  await page.waitForTimeout(600);
  const id = await page.evaluate(() => document.activeElement?.id);
  assert(id === `tl-stay-${kasiaId()}`, `active=${id}`);
  assert((await page.getByRole("dialog").count()) === 0, "Enter opened the dialog");
  const dimmed = await page.locator("[data-tl-bar].opacity-25").count();
  assert(dimmed > 3, `dimmed=${dimmed}`);
  await page.getByPlaceholder("Find a client…").fill("");
  await open("&days=14&from=2026-09-07");
});

await step("drag across free cells opens New booking with the run prefilled", async () => {
  const a = await cell(U103, dayIdx("2026-09-10")).boundingBox();
  const b = await cell(U103, dayIdx("2026-09-12")).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 20, a.y + a.height / 2, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
  await page.waitForTimeout(100);
  const label = await page.locator("[data-tl-unit] .bg-primary\\/15").first().textContent().catch(() => "");
  assert(label?.includes("3 nights"), `label=${label}`);
  await page.mouse.up();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ timeout: 5000 });
  await dialog.getByText(/3 nights/).first().waitFor({ timeout: 10000 });
  const unit = await dialog.locator("select").last().inputValue().catch(() => "");
  assert(unit === U103, `unit select=${unit}`);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached", timeout: 5000 });
});

await step("click a free cell opens New booking on that day", async () => {
  const a = await cell(U103, dayIdx("2026-09-14")).boundingBox();
  await page.mouse.click(a.x + a.width / 2, a.y + a.height / 2);
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ timeout: 5000 });
  await dialog.getByText(/check-in 15:00|Pick a check-out|check-out/).first().waitFor({ timeout: 10000 });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached", timeout: 5000 });
});

await step("drag a stay 3 days earlier moves it (server) and Undo moves it back", async () => {
  await open("&days=14&from=2026-09-17");
  const bar = page.locator(`#tl-stay-${kasiaId()}`);
  const box = await bar.boundingBox();
  const cw = await cellPx();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 10, box.y + box.height / 2, { steps: 2 });
  await page.mouse.move(box.x + box.width / 2 - 3 * cw, box.y + box.height / 2, { steps: 8 });
  await page.waitForTimeout(150);
  const ghost = await page.locator("[data-tl-unit] .border-primary.pointer-events-none").first().textContent().catch(() => "");
  assert(ghost?.includes("21 Sept"), `ghost=${ghost}`);
  await page.mouse.up();
  await page.getByText("Stay moved").first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);
  const start = sql(`select (starts_at at time zone 'Europe/Warsaw')::date from bookings where client_name='TLQA Kasia Mazur' and status='confirmed'`);
  assert(start === "2026-09-21", `db start=${start}`);
  await page.getByRole("button", { name: "Undo" }).click();
  await page.waitForTimeout(3000);
  const back = sql(`select (starts_at at time zone 'Europe/Warsaw')::date from bookings where client_name='TLQA Kasia Mazur' and status='confirmed'`);
  assert(back === "2026-09-24", `db after undo=${back}`);
});

await step("a drop onto taken dates is refused with a red ghost", async () => {
  await open("&days=14&from=2026-09-17");
  const bar = page.locator(`#tl-stay-${kasiaId()}`);
  const box = await bar.boundingBox();
  const cw = await cellPx();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 10, box.y + box.height / 2, { steps: 2 });
  await page.mouse.move(box.x + box.width / 2 - 6 * cw, box.y + box.height / 2, { steps: 8 }); // onto Tomasz's hold 18→20
  await page.waitForTimeout(150);
  const red = await page.locator("[data-tl-unit] .border-destructive.pointer-events-none").count();
  assert(red === 1, `red ghosts=${red}`);
  await page.mouse.up();
  await page.getByText("Those dates are taken here.").waitFor({ timeout: 5000 });
  const start = sql(`select (starts_at at time zone 'Europe/Warsaw')::date from bookings where client_name='TLQA Kasia Mazur' and status='confirmed'`);
  assert(start === "2026-09-24", `db start=${start}`);
});

await step("dragging the right edge extends the stay by a night", async () => {
  await open("&days=14&from=2026-09-17");
  const bar = page.locator(`#tl-stay-${kasiaId()}`);
  const box = await bar.boundingBox();
  const cw = await cellPx();
  await page.mouse.move(box.x + box.width - 3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 8, box.y + box.height / 2, { steps: 2 });
  await page.mouse.move(box.x + box.width - 3 + cw, box.y + box.height / 2, { steps: 6 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.getByText("Stay moved").first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);
  const end = sql(`select (ends_at at time zone 'Europe/Warsaw')::date from bookings where client_name='TLQA Kasia Mazur' and status='confirmed'`);
  assert(end === "2026-09-28", `db end=${end}`);
  sql(`update bookings set ends_at = ('2026-09-27 11:00'::timestamp at time zone 'Europe/Warsaw') where client_name='TLQA Kasia Mazur' and status='confirmed'`);
});

await step("keyboard: arrows move focus between cells and lanes, Enter books", async () => {
  await open("&days=14&from=2026-09-07");
  await cell(U102, dayIdx("2026-09-10")).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  const active = await page.evaluate(() => document.activeElement?.getAttribute("data-tl-cell"));
  assert(active === `${U103}:${dayIdx("2026-09-12")}`, `active=${active}`);
  await page.keyboard.press("Enter");
  await page.getByRole("dialog").waitFor({ timeout: 5000 });
  await page.keyboard.press("Escape");
});

await step("keyboard: PageDown moves a window, t goes to today", async () => {
  await cell(U102, dayIdx("2026-09-10")).focus();
  await page.keyboard.press("PageDown");
  await page.waitForTimeout(1500);
  assert(page.url().includes("from=2026-09-21"), page.url());
  await page.keyboard.press("t");
  await page.waitForTimeout(1500);
  assert(!page.url().includes("from="), page.url());
});

await step("a settled scroll commits the new start to the URL", async () => {
  await open("&days=14&from=2026-09-07");
  const cw = await cellPx();
  await scroller().evaluate((el, cw) => { el.scrollLeft += 5 * cw; }, cw);
  await page.waitForTimeout(1800);
  assert(page.url().includes("from=2026-09-12"), page.url());
});

await step("dragging the date header pans and commits", async () => {
  await open("&days=14&from=2026-09-07");
  const cw = await cellPx();
  const head = await page.getByText("September 2026").boundingBox();
  await page.mouse.move(head.x + 300, head.y + 5);
  await page.mouse.down();
  await page.mouse.move(head.x + 290, head.y + 5, { steps: 2 });
  await page.mouse.move(head.x + 300 - 4 * cw, head.y + 5, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(1800);
  assert(page.url().includes("from=2026-09-11"), page.url());
});

await step("collapse a group, it stays collapsed after reload", async () => {
  await open("&days=14&from=2026-09-07");
  await page.getByRole("button", { name: "Collapse Apartment" }).click();
  assert((await cell(U103, 10).count()) === 0, "lanes still there");
  await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(1200);
  assert((await cell(U103, 10).count()) === 0, "lanes came back");
  await page.getByRole("button", { name: "Expand Apartment" }).click();
  assert((await cell(U103, 10).count()) === 1, "lanes did not return");
});

await step("the window label opens a date picker that jumps", async () => {
  await page.getByRole("button", { name: "Go to date" }).click();
  await page.getByRole("button", { name: /24 September 2026/ }).click();
  await page.waitForTimeout(1500);
  assert(page.url().includes("from=2026-09-24"), page.url());
});

await step("day header links to the Day view", async () => {
  await open("&days=14&from=2026-09-07");
  const href = await page.getByRole("link", { name: "Open 10 Sept 2026" }).getAttribute("href");
  assert(href === "/bookings?view=day&date=2026-09-10", href);
});

await step("conflicts chip Show opens the first conflict's card", async () => {
  await page.getByRole("button", { name: /2 conflicts/ }).click();
  await page.waitForTimeout(800);
  const tip = await page.locator('[data-slot="tooltip-content"]').first().textContent().catch(() => "");
  assert(tip?.includes("Overlaps") || tip?.includes("Unavailable") || tip?.includes("Turnover"), `tip=${tip}`);
});

await step("no console errors", async () => { assert(errors.length === 0, errors.join(" | ").slice(0, 500)); });

async function expect_text(loc) { await loc.waitFor({ timeout: 5000 }); }
await browser.close();
const fails = results.filter(([s]) => s === "FAIL").length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
