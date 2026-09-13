#!/usr/bin/env node
/**
 * In-app subscription management QA — local dev against the STRIPE SANDBOX
 * (test mode), which is the only way to prove Managed Payments accepts
 * `subscriptions.update` at all.
 *   npm run dev            # http://localhost:3000 (never 127.0.0.1)
 *   node scripts/qa-billing-manage.mjs
 * Walks the demo org's live sandbox subscription through switch → cancel →
 * resume → switch back, and leaves it on the plan it started on.
 */
import { readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
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
const row = async () => (await db.from("org_subscriptions").select("plan, billing_interval, cancel_at_period_end, status").eq("org_id", org.id).single()).data;
const before = await row();
console.log("starting row:", before);

/* Stripe's side of the story. An upgrade must produce a PAID invoice today —
   that is the whole question "why weren't we charged?" was asking — and a
   downgrade must produce none, because its credit rides to the next one. */
const stripe = process.env.BILLING_PROVIDER === "stripe" ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const subId = async () => (await db.from("org_subscriptions").select("provider_subscription_id").eq("org_id", org.id).single()).data.provider_subscription_id;
async function invoices() {
  if (!stripe) return [];
  return (await stripe.invoices.list({ subscription: await subId(), limit: 5 })).data;
}
/** The invoices this switch created, newest first. */
async function invoicedSince(ids) {
  const now = await invoices();
  return now.filter((i) => !ids.has(i.id));
}
const idsOf = (list) => new Set(list.map((i) => i.id));

// Pro → Team is the upgrade whichever way round this run starts.
const other = before.plan === "pro" ? "team" : "pro";
const label = (p) => (p === "pro" ? "Pro" : "Team");

const results = [];
const assert = (c, m) => { if (!c) throw new Error(m); };
async function step(n, title, fn) {
  process.stdout.write(`\n── Step ${n}: ${title}\n`);
  try { const d = await fn(); results.push(true); console.log(`   ✓ ${d ?? "ok"}`); }
  catch (e) { results.push(false); console.log(`   ✗ ${e?.message ?? e}`); await page.screenshot({ path: path.join(OUT, `billing-fail-${n}.png`), fullPage: true }).catch(() => {}); }
}

const chromium = await loadChromium();
const browser = await chromium.launch({ headless: process.env.QA_HEADED !== "1" });
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: "en-GB" });
context.setDefaultTimeout(45_000);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.locator("#email").fill(EMAIL);
await page.locator("#password").fill(PASSWORD);
await page.locator('form button[type="submit"]').first().click();
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });

const gotoBilling = async () => page.goto(`${BASE}/billing`, { waitUntil: "domcontentloaded" });
// "Ends on" / "Renews on" appear only on the plan card.
const period = (re) => page.getByText(re).first();

await step(1, "the plan card offers cancel and the card form — not a portal button", async () => {
  await gotoBilling();
  await page.screenshot({ path: path.join(OUT, "billing-1-initial.png"), fullPage: true });
  await page.getByRole("button", { name: "Cancel plan", exact: true }).first().waitFor();
  await page.getByRole("button", { name: "Payment method" }).waitFor();
  assert((await page.getByText("Manage subscription").count()) === 0, "the old portal button is still there");
  return (await page.getByText(/Renews on|Ends on/).first().innerText());
});

await step(2, `switch ${label(before.plan)} → ${label(other)} against the Stripe sandbox`, async () => {
  const seen = idsOf(await invoices());
  await page.getByRole("button", { name: `Switch to ${label(other)}` }).click();
  await page.waitForURL(/changed=(charged|credited)/, { timeout: 60_000 });
  const r = await row();
  assert(r.plan === other, `row still says ${r.plan}`);
  const fresh = await invoicedSince(seen);
  if (other === "team") {
    // The upgrade: invoiced and SETTLED today, not at the renewal. The total
    // can be 0 when earlier switches left pending credits — this invoice
    // sweeps them up — so the test is that one exists and is paid, not that
    // money always moves.
    assert(fresh.length === 1, `an upgrade created ${fresh.length} invoices`);
    assert(fresh[0].status === "paid", `invoice is ${fresh[0].status} for ${fresh[0].total}`);
    assert(page.url().includes("changed=charged"), "the page didn't say it charged");
  } else {
    // The downgrade: nothing billed now, the credit waits for the next one.
    assert(fresh.length === 0, `a downgrade created an invoice: ${fresh[0]?.id}`);
    assert(page.url().includes("changed=credited"), "the page didn't say it credited");
  }
  await page.screenshot({ path: path.join(OUT, "billing-2-switch.png"), fullPage: true });
  return `row: ${r.plan}/${r.billing_interval} · stripe: ${fresh.length ? `${fresh[0].status} ${fresh[0].total}` : "no invoice"} · page: ${await page.locator('[role="status"]').first().innerText()}`;
});

await step(3, "cancel asks first, then schedules the end", async () => {
  await page.getByRole("button", { name: "Cancel plan", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await page.screenshot({ path: path.join(OUT, "billing-3-confirm.png"), fullPage: true });
  assert((await dialog.getByRole("button", { name: "Keep plan" }).count()) === 1, "no explicit way out of the dialog");
  await dialog.getByRole("button", { name: "Cancel plan", exact: true }).click();
  await page.waitForURL(/changed=cancelled/, { timeout: 60_000 });
  const r = await row();
  assert(r.cancel_at_period_end === true, "the row does not say it is cancelling");
  assert(await period(/Ends on/).isVisible(), "the card still says Renews on");
  await page.screenshot({ path: path.join(OUT, "billing-4-cancelled.png"), fullPage: true });
  return `row.cancel_at_period_end=${r.cancel_at_period_end}`;
});

await step(4, "resume clears it", async () => {
  await page.getByRole("button", { name: "Resume plan" }).click();
  await page.waitForURL(/changed=resumed/, { timeout: 60_000 });
  const r = await row();
  assert(r.cancel_at_period_end === false, "the row still says it is cancelling");
  assert(await period(/Renews on/).isVisible(), "the card still says Ends on");
  return "renews again";
});

// The picker opens on the interval the org is billed on, so the OTHER tab is
// where the interval switch lives.
const otherInterval = before.billing_interval === "year" ? "month" : "year";
const tab = (i) => page.getByRole("button", { name: i === "year" ? "Yearly" : "Monthly", exact: true });
const switchInterval = (i) => page.getByRole("button", { name: i === "year" ? "Switch to yearly" : "Switch to monthly" });

await step(5, `switch the interval (${before.billing_interval} → ${otherInterval}) — the move Stripe charges for today`, async () => {
  await gotoBilling();
  await tab(otherInterval).click();
  await switchInterval(otherInterval).click();
  await page.waitForURL(/changed=interval/, { timeout: 60_000 });
  const r = await row();
  assert(r.billing_interval === otherInterval, `row still says ${r.billing_interval}`);
  assert(r.status === "active", `subscription went ${r.status}`);
  await page.screenshot({ path: path.join(OUT, "billing-5-interval.png"), fullPage: true });
  return `row: ${r.plan} / ${r.billing_interval} / ${r.status}`;
});

await step(6, "switch back to the plan and interval it started on", async () => {
  // Always from a clean /billing: `waitForURL` returns at once if the URL
  // ALREADY carries ?changed=plan from the step before, and the next click
  // then races the navigation.
  await gotoBilling();
  await tab(before.billing_interval).click();
  await switchInterval(before.billing_interval).click();
  await page.waitForURL(/changed=interval/, { timeout: 60_000 });
  await gotoBilling();
  const seen = idsOf(await invoices());
  await page.getByRole("button", { name: `Switch to ${label(before.plan)}` }).click();
  await page.waitForURL(/changed=(charged|credited)/, { timeout: 60_000 });
  // The direction not covered by step 2, and the same rule has to hold.
  const fresh = await invoicedSince(seen);
  assert(before.plan === "team" ? fresh.length === 1 && fresh[0].status === "paid" : fresh.length === 0,
    `the way back invoiced ${fresh.length} times (${fresh.map((i) => `${i.status} ${i.total}`).join(", ") || "none"})`);
  const r = await row();
  assert(r.plan === before.plan && r.billing_interval === before.billing_interval, `left on ${r.plan}/${r.billing_interval}`);
  return `back to ${r.plan} / ${r.billing_interval}`;
});

await step(7, "payment method hands over to Stripe's hosted card form", async () => {
  await page.getByRole("button", { name: "Payment method" }).click();
  await page.waitForURL(/stripe\.com/, { timeout: 60_000 });
  return page.url().replace(/\/(session|p)\/.*/, "/…");
});

console.log(`\nSubscription now:`, await row());
console.log("page errors:", errors.length ? errors : "none");
console.log(`\n${results.filter(Boolean).length}/${results.length} steps passed · shots in ${OUT}`);
await browser.close();
process.exit(results.every(Boolean) && errors.length === 0 ? 0 : 1);
