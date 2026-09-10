#!/usr/bin/env node
/**
 * S6 (compound resources) browser QA — the seven steps of the slice's plan,
 * driven through the real UI against a local dev server.
 *
 *   npm run dev                      # keep it on http://localhost:3000
 *   node scripts/qa-s6-compound.mjs  # prints PASS n/7, exits non-zero on any failure
 *
 * Env:
 *   BASE_URL           default http://localhost:3000 (NEVER 127.0.0.1 — Next dev
 *                      blocks the HMR socket cross-origin and nothing hydrates)
 *   PLAYWRIGHT_MODULE  override the Playwright entry point (default: the
 *                      installed package, else the newest npx cache copy)
 *   QA_HEADED=1        watch it run
 *   QA_TAG             reuse a run tag (names are tagged so re-runs never collide)
 *
 * Setup it performs on the local demo org (dev database only, announced on stdout):
 *   - flips the org to Spaces mode (the S6 surfaces are the spaces channel),
 *   - grants a comp Team plan (org_plan_overrides — the /utils path) so the Free
 *     two-resource cap doesn't refuse the rooms this script has to create,
 *   - deactivates the spaces a previous run of this script left behind.
 */
import { readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { createClient } from "@supabase/supabase-js";

// ── environment ────────────────────────────────────────────────────────────
try {
  loadEnvFile(".env.local");
} catch {
  // Already-exported env is fine.
}

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const HANDLE = "demo-studio";
const EMAIL = "demo@rolloutos.local";
const PASSWORD = "Password123!";
const TAG = process.env.QA_TAG ?? Date.now().toString(36).slice(-5).toUpperCase();
const ARTIFACTS = process.env.QA_ARTIFACTS ?? tmpdir();

const NAMES = {
  roomOne: `S6QA ${TAG} Room One`,
  roomTwo: `S6QA ${TAG} Room Two`,
  studio: `S6QA ${TAG} Whole studio`,
  lamp: `S6QA ${TAG} ARRI lamp`,
};
const ROOM_PRICE = 100;
const STUDIO_PRICE = 250;
const LAMP_PRICE = 50;
const LAMP_ITEMS = 2;

/** Playwright: the installed package, else the newest npx cache copy. */
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

// ── tiny harness ───────────────────────────────────────────────────────────
const results = [];
function assert(cond, message) {
  if (!cond) throw new Error(message);
}
async function step(n, title, fn) {
  process.stdout.write(`\n── Step ${n}: ${title}\n`);
  try {
    const detail = await fn();
    results.push({ n, title, ok: true, detail });
    console.log(`   ✓ ${detail ?? "ok"}`);
  } catch (error) {
    results.push({ n, title, ok: false, detail: String(error?.message ?? error) });
    console.log(`   ✗ ${error?.message ?? error}`);
  }
}

// ── dates: a weekday a week out, in the org's zone ─────────────────────────
const ORG_TZ = "Europe/Berlin";
const dayKey = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: ORG_TZ });
const dayCellLabel = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
function weekdayOnOrAfter(daysAhead) {
  // The default week is Mon–Fri 09:00–17:00, so a weekend day offers nothing.
  // The date is the ORG's, and so is the weekday read off it.
  let iso = dayKey.format(new Date(Date.now() + daysAhead * 86_400_000));
  while ([0, 6].includes(new Date(`${iso}T00:00:00Z`).getUTCDay())) {
    iso = new Date(new Date(`${iso}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
  }
  return iso;
}
const DAY = weekdayOnOrAfter(7);
const DAY_LABEL = dayCellLabel.format(new Date(`${DAY}T00:00:00Z`));
const H_STUDIO = "09:00";
const H_LAMP = "11:00";
const H_PLAIN = "14:00";

// ── setup: the org row, the plan, last run's leftovers ─────────────────────
async function prepareOrg() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(url && key, "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (.env.local)");
  assert(new URL(url).hostname === "127.0.0.1" || new URL(url).hostname === "localhost", `refusing to touch a non-local Supabase (${url})`);
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: org, error } = await db.from("orgs").select("id, name, offers_rentals, offers_appointments").eq("handle", HANDLE).maybeSingle();
  if (error) throw error;
  assert(org, `no org with handle "${HANDLE}" — run npm run db:seed`);

  if (!org.offers_rentals) {
    const { error: modeError } = await db.from("orgs").update({ offers_rentals: true, offers_appointments: false }).eq("id", org.id);
    if (modeError) throw modeError;
    console.log(`   setup: "${org.name}" switched to Spaces mode`);
  }

  const { error: planError } = await db
    .from("org_plan_overrides")
    .upsert({ org_id: org.id, plan: "team", expires_at: null, note: "S6 browser QA", granted_by: "qa-s6-compound.mjs" }, { onConflict: "org_id" });
  if (planError) throw planError;

  // Last run's spaces: deactivated, not deleted — their bookings stay readable
  // and their units stop spending the plan's resource budget.
  const { data: stale, error: staleError } = await db.from("rental_offerings").select("id, name").eq("org_id", org.id).ilike("name", "S6QA %");
  if (staleError) throw staleError;
  const old = (stale ?? []).filter((o) => !o.name.startsWith(`S6QA ${TAG} `));
  if (old.length > 0) {
    const ids = old.map((o) => o.id);
    await db.from("rental_units").update({ active: false }).in("offering_id", ids);
    await db.from("rental_offerings").update({ active: false }).in("id", ids);
    console.log(`   setup: deactivated ${old.length} space(s) from earlier runs`);
  }
}

// ── page helpers ───────────────────────────────────────────────────────────
async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator("#email").fill(EMAIL);
  await page.locator("#password").fill(PASSWORD);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
}

/** Creates one space through /rentals/new and returns its id (from the list row). */
async function createSpace(page, { kind, name, price, rangeMode, components = [], itemCount }) {
  // The kind rides the URL (the list's New menu); the form asks only name,
  // how it's booked, price — and lands on the new space's page.
  await page.goto(`${BASE}/rentals/new${kind === "space" ? "" : `?kind=${kind}`}`, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="name"]').waitFor({ state: "visible" });
  await page.locator('input[name="name"]').fill(name);
  if (kind === "space") await page.locator(`input[name="rangeMode"][value="${rangeMode}"]`).check({ force: true });
  for (const room of components) {
    await page.locator("label").filter({ hasText: room }).locator('[role="checkbox"]').click();
  }
  await page.locator("#offering-price").fill(String(price));
  if (itemCount !== undefined) await page.locator("#offering-item-count").fill(String(itemCount));
  await page.getByRole("button", { name: "Create space" }).click();
  await page.waitForURL(/\/rentals\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  return page.url().split("/").pop();
}

/** The row of /rentals for one space, as text (badges included). */
async function spaceRowText(page, name) {
  await page.goto(`${BASE}/rentals`, { waitUntil: "domcontentloaded" });
  return page.locator('li[role="row"]').filter({ hasText: name }).first().innerText();
}

/** Opens the hosted page straight on one space and picks day+time. */
async function openSlot(page, offeringId, { day = DAY, time }) {
  await page.goto(`${BASE}/${HANDLE}?lang=en&space=${offeringId}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^1 h/ }).first().click();
  const label = dayCellLabel.format(new Date(`${day}T00:00:00Z`));
  const cell = page.getByRole("option", { name: label });
  // The month arrives from a server action — wait for the grid before deciding
  // it isn't this month, or the first look always navigates past the target.
  await page.locator('[role="listbox"] [role="option"]').first().waitFor({ state: "attached", timeout: 60_000 });
  for (let i = 0; i < 3 && (await cell.count()) === 0; i++) {
    await page.getByRole("button", { name: "Next month" }).click();
    await page.waitForTimeout(1500);
  }
  assert((await cell.count()) > 0, `no day cell for ${label}`);
  assert(await cell.first().isEnabled(), `${label} offers no free time (day cell disabled)`);
  await cell.first().click();
  const chip = page.getByRole("button", { name: new RegExp(`, ${time}$`) });
  assert((await chip.count()) > 0, `no ${time} slot on ${label}`);
  await chip.first().click();
  await page.locator("#hourly-name").waitFor({ state: "visible" });
}

/** The confirm step's own form (the shell has a sign-out form too). */
function widgetForm(page) {
  return page.locator("form").filter({ has: page.locator("#hourly-name") });
}

/** The equipment row of the confirm step, as text. */
function equipmentRow(page, name) {
  return page.locator('ul[aria-label="Equipment"] li').filter({ hasText: name }).first();
}

/** Fills the details, confirms, and returns the new booking's manage token. */
async function confirmBooking(page, who) {
  await page.locator("#hourly-name").fill(who.name);
  await page.locator("#hourly-email").fill(who.email);
  await page.getByRole("button", { name: /^(Confirm booking|Request to book)$/ }).click();
  // Either the confirmation panel or the flow's own refusal line — polled,
  // so a refused booking says why instead of timing out on the missing link.
  const link = page.locator('a[href*="/booking/"]').first();
  const refused = page.locator('p[role="alert"]').first();
  let href = null;
  for (let i = 0; i < 120 && href === null; i++) {
    if ((await link.count()) > 0) href = await link.getAttribute("href");
    else if ((await refused.count()) > 0) {
      const why = (await refused.innerText()).trim();
      if (why !== "") throw new Error(`the booking was refused: ${why}`);
    }
    if (href === null) await page.waitForTimeout(500);
  }
  assert(href, "no confirmation and no refusal after 60s");
  const token = href.match(/\/booking\/([^/?#]+)/)?.[1];
  assert(token, `no manage token in "${href}"`);
  return token;
}

async function bodyText(page) {
  return page.locator("body").innerText();
}

// ── the run ────────────────────────────────────────────────────────────────
const chromium = await loadChromium();
console.log(`S6 compound resources — browser QA`);
console.log(`  base   ${BASE}`);
console.log(`  tag    ${TAG}   day ${DAY} (${DAY_LABEL})`);
await prepareOrg();

const browser = await chromium.launch({ headless: !process.env.QA_HEADED });
const context = await browser.newContext({
  timezoneId: ORG_TZ,
  locale: "en-GB",
  viewport: { width: 1440, height: 1000 },
  // The public mutation limiter buckets by x-forwarded-for, else by the
  // literal "server" — so without this every local run shares one 10/minute
  // bucket with the last one and a mid-run booking is refused. One address
  // per run: this run's own visitors, nobody else's.
  extraHTTPHeaders: { "x-forwarded-for": `10.77.${(parseInt(TAG, 36) >> 8) & 255}.${parseInt(TAG, 36) & 255}` },
});
context.setDefaultTimeout(30_000);
const page = await context.newPage();
const ids = {};
const tokens = {};

try {
  await login(page);

  await step(1, "a composite space includes both rooms", async () => {
    ids.roomOne = await createSpace(page, { kind: "space", rangeMode: "hours", name: NAMES.roomOne, price: ROOM_PRICE });
    ids.roomTwo = await createSpace(page, { kind: "space", rangeMode: "hours", name: NAMES.roomTwo, price: ROOM_PRICE });
    ids.studio = await createSpace(page, {
      kind: "composite",
      name: NAMES.studio,
      price: STUDIO_PRICE,
      components: [NAMES.roomOne, NAMES.roomTwo],
    });
    const row = await spaceRowText(page, NAMES.studio);
    assert(row.includes("Includes 2 rooms"), `spaces list row reads:\n${row}`);
    return `"${NAMES.studio}" listed with "Includes 2 rooms"`;
  });

  await step(2, "an equipment space is an add-on, and never public", async () => {
    ids.lamp = await createSpace(page, { kind: "equipment", name: NAMES.lamp, price: LAMP_PRICE, itemCount: LAMP_ITEMS });
    const row = await spaceRowText(page, NAMES.lamp);
    assert(row.includes("Add-on"), `spaces list row reads:\n${row}`);
    await page.goto(`${BASE}/${HANDLE}?lang=en`, { waitUntil: "domcontentloaded" });
    const text = await bodyText(page);
    assert(text.includes(NAMES.roomOne), `the public page does not list "${NAMES.roomOne}" either — wrong page?`);
    assert(!text.includes(NAMES.lamp), `the public page lists "${NAMES.lamp}"`);
    return `"${NAMES.lamp}" chipped "Add-on"; absent from /${HANDLE}`;
  });

  await step(3, "a whole-studio booking ghosts onto both room lanes", async () => {
    await openSlot(page, ids.studio, { time: H_STUDIO });
    tokens.studio = await confirmBooking(page, { name: `QA Studio ${TAG}`, email: `qa-studio-${TAG}@example.com` });
    const from = dayKey.format(new Date(`${DAY}T12:00:00Z`).getTime() - 2 * 86_400_000);
    await page.goto(`${BASE}/bookings?view=timeline&from=${from}&days=14`, { waitUntil: "domcontentloaded" });
    await page.locator('button[aria-label^="New booking, "]').first().waitFor({ state: "visible", timeout: 60_000 });
    const seen = await page.evaluate(
      ({ lanes, studio }) => {
        // A single-unit space's rail is deliberately nameless (it is named in
        // the header above its lane), so the only stable per-lane handle in the
        // DOM is the lane's own empty-cell button, "New booking, <lane>, <date>"
        // (bookings.timeline.newHere). If that label changes, this breaks.
        const trackOf = (lane) => {
          const btn = [...document.querySelectorAll("button[aria-label]")].find((b) =>
            b.getAttribute("aria-label").startsWith(`New booking, ${lane},`),
          );
          return btn?.parentElement?.parentElement ?? null;
        };
        const report = {};
        for (const lane of [...lanes, studio]) {
          const track = trackOf(lane);
          if (!track) {
            report[lane] = { lane: false };
            continue;
          }
          const bars = [...track.querySelectorAll("[aria-label]")];
          report[lane] = {
            lane: true,
            primary: bars.filter((b) => b.id.startsWith("tl-stay-")).length,
            ghosts: bars.filter(
              (b) => b.getAttribute("aria-label").startsWith(`${studio} · `) && b.className.includes("border-dashed") && b.className.includes("opacity-70"),
            ).length,
          };
        }
        return report;
      },
      { lanes: [NAMES.roomOne, NAMES.roomTwo], studio: NAMES.studio },
    );
    for (const lane of [NAMES.roomOne, NAMES.roomTwo]) {
      assert(seen[lane]?.lane, `no timeline lane for "${lane}"`);
      assert(seen[lane].ghosts >= 1, `no dashed "${NAMES.studio} · …" bar on the "${lane}" lane (${JSON.stringify(seen[lane])})`);
    }
    assert(seen[NAMES.studio]?.primary >= 1, `no solid booking bar on the "${NAMES.studio}" lane (${JSON.stringify(seen[NAMES.studio])})`);
    return `booked ${DAY} ${H_STUDIO}; solid bar on the studio lane, dashed on both rooms`;
  });

  await step(4, "equipment is capped by what is free at that hour", async () => {
    await openSlot(page, ids.roomOne, { time: H_LAMP });
    const row = equipmentRow(page, NAMES.lamp);
    const before = await row.innerText();
    assert(before.includes(`${LAMP_ITEMS} available`), `equipment row reads:\n${before}`);
    const more = row.getByRole("button", { name: `More: ${NAMES.lamp}` });
    await more.click();
    await more.click();
    assert(await more.isDisabled(), "the + button is still enabled at 2 of 2 lamps");
    const money = await widgetForm(page).innerText();
    const total = ROOM_PRICE + LAMP_PRICE * LAMP_ITEMS; // 1 h, per-hour lamp
    assert(money.includes(`${NAMES.lamp} × ${LAMP_ITEMS}`), `no equipment line in the quote:\n${money}`);
    assert(new RegExp(`Total:[^\\n]*${total}`).test(money), `total is not ${total}:\n${money}`);
    tokens.lamp = await confirmBooking(page, { name: `QA Lamp ${TAG}`, email: `qa-lamp-${TAG}@example.com` });

    await openSlot(page, ids.roomTwo, { time: H_LAMP });
    const other = equipmentRow(page, NAMES.lamp);
    const after = await other.innerText();
    assert(after.includes("none left at this time"), `the other room's equipment row reads:\n${after}`);
    assert(await other.getByRole("button", { name: `More: ${NAMES.lamp}` }).isDisabled(), "the + button is enabled with no lamp free");
    return `2 of 2 taken at ${H_LAMP}; total ${total}; the other room says "none left at this time"`;
  });

  await step(5, '"Also reserved" only where something else is held', async () => {
    await openSlot(page, ids.roomTwo, { time: H_PLAIN });
    tokens.plain = await confirmBooking(page, { name: `QA Plain ${TAG}`, email: `qa-plain-${TAG}@example.com` });
    await page.goto(`${BASE}/booking/${tokens.plain}?lang=en`, { waitUntil: "domcontentloaded" });
    const plain = await bodyText(page);
    assert(plain.includes(NAMES.roomTwo), `the manage page does not name "${NAMES.roomTwo}":\n${plain}`);
    assert(!plain.includes("Also reserved"), `a plain room booking shows "Also reserved":\n${plain}`);

    await page.goto(`${BASE}/booking/${tokens.studio}?lang=en`, { waitUntil: "domcontentloaded" });
    const studio = await bodyText(page);
    const line = studio.split("\n").find((l) => l.startsWith("Also reserved"));
    assert(line, `the whole-studio manage page has no "Also reserved" line:\n${studio}`);
    assert(line.includes(NAMES.roomOne) && line.includes(NAMES.roomTwo), `"Also reserved" misses a room: ${line}`);
    return `plain booking: no line; whole studio: "${line}"`;
  });

  await step(6, "a rescheduled booking keeps its equipment", async () => {
    await page.goto(`${BASE}/booking/${tokens.lamp}?lang=en`, { waitUntil: "domcontentloaded" });
    assert((await bodyText(page)).includes(`${NAMES.lamp} × ${LAMP_ITEMS}`), "the lamp booking does not list its equipment before the move");
    await page.getByRole("button", { name: "Reschedule" }).click();
    const slot = page.getByRole("button", { name: /, \d{2}:\d{2}$/ }).first();
    await slot.waitFor({ state: "visible", timeout: 60_000 });
    const moved = await slot.getAttribute("aria-label");
    await slot.click();
    await page.getByRole("button", { name: "Confirm new time" }).click();
    await page.waitForURL((u) => u.pathname.startsWith("/booking/") && !u.pathname.includes(tokens.lamp), { timeout: 60_000 });
    const text = await bodyText(page);
    assert(text.includes(`${NAMES.lamp} × ${LAMP_ITEMS}`), `the moved booking lost its equipment line:\n${text}`);
    assert(text.includes("Also reserved") && text.includes(NAMES.lamp), `the moved booking does not hold the lamp any more:\n${text}`);
    return `moved to ${moved}; equipment line and hold carried over`;
  });

  await step(7, "cancelling the studio frees its rooms", async () => {
    await page.goto(`${BASE}/booking/${tokens.studio}?lang=en`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Cancel booking" }).click();
    await page.getByRole("button", { name: "Yes, cancel this booking" }).click();
    await page.getByText("Cancelled", { exact: false }).first().waitFor({ state: "visible", timeout: 60_000 });
    await openSlot(page, ids.roomOne, { time: H_STUDIO });
    tokens.rebook = await confirmBooking(page, { name: `QA Rebook ${TAG}`, email: `qa-rebook-${TAG}@example.com` });
    await page.goto(`${BASE}/booking/${tokens.rebook}?lang=en`, { waitUntil: "domcontentloaded" });
    const text = await bodyText(page);
    assert(text.includes(NAMES.roomOne), `the re-booking is not on "${NAMES.roomOne}":\n${text}`);
    assert(!text.includes("Also reserved"), `the re-booking claims to hold something else:\n${text}`);
    return `${DAY} ${H_STUDIO} bookable on "${NAMES.roomOne}" again once the studio released it`;
  });
} catch (error) {
  const shot = path.join(ARTIFACTS, `qa-s6-${TAG}.png`);
  await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
  console.error(`\nrun aborted: ${error?.message ?? error}\nscreenshot: ${shot}`);
  results.push({ n: results.length + 1, title: "run", ok: false, detail: String(error?.message ?? error) });
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
console.log("\n────────────────────────────────────────");
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.n}. ${r.title} — ${r.detail}`);
console.log(`\nPASS ${passed}/7`);
process.exit(passed === 7 ? 0 : 1);
