# H3 — Prices & Terms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Structured pricing, deposit policy, enforced cancellation window, and terms acceptance on rental offerings, displayed end-to-end with "pay at the venue" collection (no Stripe).

**Architecture:** Flat columns on `rental_offerings` + `orgs.currency` + a money snapshot on `bookings`, computed inside the definer RPCs (never a client input). One pure TS pricing/formatting mirror for display. Migrations 0057 (drizzle-generated) + 0058 (custom SQL: CHECKs, helper functions, RPC replacements).

**Tech Stack:** Next.js (App Router), Drizzle schema + hand-written SQL migrations, Supabase (Postgres definer RPCs, RLS), Zod, Vitest (`npm run test` unit / `npm run test:integration` against the local stack), React 19 server actions.

**Spec:** `docs/superpowers/specs/2026-08-24-h3-prices-terms-design.md`

## Global Constraints

- Branch: `feat/h3-prices` (already cut from merged main). Commit after every task; end commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Migration numbering: generated file must be **0057** (`npm run db:generate`), custom file is **0058_prices_terms.sql** with a hand-added `_journal.json` entry (idx 58, version "7", `when` = previous entry's `when` + 1000, tag `0058_prices_terms`, breakpoints true) — the 0056 precedent.
- After ANY migration change: `npm run db:reset` (local Supabase must be up: `npm run supabase:start`; this project's ports are shifted +30, Mailpit at :54354). Appending to an already-applied migration file requires db:reset (H2 lesson).
- Definer RPC discipline (copy 0056 idiom): `security definer set search_path = ''`, then `revoke all on function ... from public, anon, authenticated, service_role;` then grant the minimal role. Changing a function's **return type** requires `drop function` first, not `create or replace`.
- RPC sentinel errors are single lowercase words (`raise exception 'taken'`) detected in TS via `isRpcSentinel` (`src/lib/rpc-sentinel.ts`) — read that file and match its contract before adding the new `'cancel_window'` sentinel.
- All money is integer cents. Currency whitelist `PLN, EUR, USD, GBP, CZK` is mirrored in TS (`CURRENCIES` in `src/lib/money.ts`) and SQL (CHECK on `orgs.currency`).
- Server-authoritative money: RPCs compute totals/deposits; every TS computation is display-only.
- `services.price_label` (appointments) is untouched everywhere. Do not touch marketing pages or `FORBIDDEN_COPY`.
- Tests: hard dates time-bomb — always use the local `d(n)` offset helper pattern (`const d = (n) => addDaysISO(dateInZone(new Date(), TZ), n)`). Run `npm run verify` (lint + typecheck + unit) per task; run `npm run test:integration` in tasks that touch SQL/actions.
- Never gate behaviour on `NODE_ENV`.
- After the final task: `graphify update .`

---

### Task 1: Pure money + pricing helpers (TS mirror)

**Files:**
- Create: `src/lib/money.ts`
- Create: `src/lib/money.test.ts`
- Create: `src/features/rentals/pricing.ts`
- Create: `src/features/rentals/pricing.test.ts`

**Interfaces:**
- Consumes: `RangeMode` and `daysBetween` from `src/features/rentals/range.ts` (`daysBetween(startISO, endISO)` → whole days, end − start).
- Produces (later tasks import these exact names):
  - `money.ts`: `type Currency`, `const CURRENCIES: readonly Currency[]`, `formatMoney(cents: number, currency: string): string`
  - `pricing.ts`: `type PricingMode = "per_unit" | "flat"`, `type DepositType = "none" | "fixed" | "percent" | "full"`, `type MoneyFields = { priceCents: number | null; pricingMode: PricingMode; depositType: DepositType; depositValue: number | null }`, `stayUnits(rangeMode: "nights" | "days", startDate: string, endDate: string): number`, `totalCents(m: MoneyFields, units: number): number | null`, `depositCents(m: MoneyFields, total: number | null): number | null`, `formatOfferingPrice(o: { priceCents: number | null; pricingMode: PricingMode; rangeMode: RangeMode }, currency: string): string | null`, `formatCancelWindow(min: number): string`, `moneyInfoLines(i: { totalCents: number | null; depositCents: number | null; currency: string | null; cancelWindowMin: number }): string[]`

- [ ] **Step 1: Write the failing unit tests**

`src/lib/money.test.ts` (note: `Intl` uses non-breaking spaces — assert with ` `, and narrow no-break ` ` where a locale emits it; write the expectations by printing the actual output once and pinning it):

```ts
import { describe, expect, it } from "vitest";
import { formatMoney, CURRENCIES } from "./money";

describe("formatMoney", () => {
  it("formats whole PLN without decimals", () => {
    expect(formatMoney(12000, "PLN")).toBe("120 zł");
  });
  it("keeps cents when present", () => {
    expect(formatMoney(12050, "PLN")).toBe("120,50 zł");
  });
  it("formats EUR/USD in their home locales", () => {
    expect(formatMoney(9900, "EUR")).toBe("99 €");
    expect(formatMoney(9900, "USD")).toBe("$99");
  });
  it("falls back to en for an unknown code without throwing", () => {
    expect(formatMoney(500, "XXX")).toContain("5");
  });
  it("whitelist is exactly the five launch currencies", () => {
    expect(CURRENCIES).toEqual(["PLN", "EUR", "USD", "GBP", "CZK"]);
  });
});
```

`src/features/rentals/pricing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  stayUnits, totalCents, depositCents, formatOfferingPrice,
  formatCancelWindow, moneyInfoLines, type MoneyFields,
} from "./pricing";

const base: MoneyFields = { priceCents: 10000, pricingMode: "per_unit", depositType: "none", depositValue: null };

describe("stayUnits", () => {
  it("nights = end - start", () => expect(stayUnits("nights", "2026-09-01", "2026-09-04")).toBe(3));
  it("days are inclusive", () => expect(stayUnits("days", "2026-09-01", "2026-09-04")).toBe(4));
});

describe("totalCents", () => {
  it("per-unit multiplies", () => expect(totalCents(base, 3)).toBe(30000));
  it("fractional hours round to the cent", () =>
    expect(totalCents(base, 90 / 60)).toBe(15000));
  it("uneven fraction rounds half up", () =>
    expect(totalCents({ ...base, priceCents: 9999 }, 100 / 60)).toBe(16665));
  it("flat ignores units", () =>
    expect(totalCents({ ...base, pricingMode: "flat" }, 5)).toBe(10000));
  it("unpriced is null", () => expect(totalCents({ ...base, priceCents: null }, 3)).toBeNull());
});

describe("depositCents", () => {
  it("none → null", () => expect(depositCents(base, 30000)).toBeNull());
  it("full → total", () =>
    expect(depositCents({ ...base, depositType: "full" }, 30000)).toBe(30000));
  it("percent rounds", () =>
    expect(depositCents({ ...base, depositType: "percent", depositValue: 33 }, 10050)).toBe(3317));
  it("fixed caps at total", () =>
    expect(depositCents({ ...base, depositType: "fixed", depositValue: 50000 }, 30000)).toBe(30000));
  it("fixed on an unpriced offering passes through", () =>
    expect(depositCents({ ...base, priceCents: null, depositType: "fixed", depositValue: 20000 }, null)).toBe(20000));
  it("percent with no total → null", () =>
    expect(depositCents({ ...base, depositType: "percent", depositValue: 20 }, null)).toBeNull());
});

describe("formatOfferingPrice", () => {
  it("per-unit names the unit from rangeMode", () => {
    expect(formatOfferingPrice({ priceCents: 12000, pricingMode: "per_unit", rangeMode: "hours" }, "PLN"))
      .toBe("120 zł / hour");
    expect(formatOfferingPrice({ priceCents: 12000, pricingMode: "per_unit", rangeMode: "nights" }, "PLN"))
      .toBe("120 zł / night");
    expect(formatOfferingPrice({ priceCents: 12000, pricingMode: "per_unit", rangeMode: "days" }, "PLN"))
      .toBe("120 zł / day");
  });
  it("flat is bare", () =>
    expect(formatOfferingPrice({ priceCents: 50000, pricingMode: "flat", rangeMode: "hours" }, "PLN"))
      .toBe("500 zł"));
  it("unpriced → null", () =>
    expect(formatOfferingPrice({ priceCents: null, pricingMode: "flat", rangeMode: "days" }, "PLN")).toBeNull());
});

describe("formatCancelWindow", () => {
  it("whole days say days", () => expect(formatCancelWindow(2880)).toBe("2 days"));
  it("one day singular", () => expect(formatCancelWindow(1440)).toBe("1 day"));
  it("sub-day says hours", () => expect(formatCancelWindow(90)).toBe("1.5 hours"));
  it("one hour singular", () => expect(formatCancelWindow(60)).toBe("1 hour"));
});

describe("moneyInfoLines", () => {
  it("emits total, deposit, venue note and policy", () => {
    expect(moneyInfoLines({ totalCents: 30000, depositCents: 6000, currency: "PLN", cancelWindowMin: 1440 })).toEqual([
      "Total: 300 zł",
      "Deposit due: 60 zł",
      "Payment: pay at the venue",
      "Free cancellation until 1 day before start",
    ]);
  });
  it("no money → only the policy line when a window is set", () =>
    expect(moneyInfoLines({ totalCents: null, depositCents: null, currency: null, cancelWindowMin: 120 }))
      .toEqual(["Free cancellation until 2 hours before start"]));
  it("nothing set → empty", () =>
    expect(moneyInfoLines({ totalCents: null, depositCents: null, currency: null, cancelWindowMin: 0 })).toEqual([]));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/money.test.ts src/features/rentals/pricing.test.ts`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement `src/lib/money.ts`**

```ts
// Client-safe money formatting. All amounts are integer cents; the org's
// currency (orgs.currency, 0058 CHECK) picks the display locale.
export const CURRENCIES = ["PLN", "EUR", "USD", "GBP", "CZK"] as const;
export type Currency = (typeof CURRENCIES)[number];

const LOCALE: Record<Currency, string> = {
  PLN: "pl-PL", EUR: "de-DE", USD: "en-US", GBP: "en-GB", CZK: "cs-CZ",
};

export function formatMoney(cents: number, currency: string): string {
  const locale = LOCALE[currency as Currency] ?? "en";
  const fractional = cents % 100 !== 0;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: fractional ? 2 : 0,
      maximumFractionDigits: fractional ? 2 : 0,
    }).format(cents / 100);
  } catch {
    // Unknown ISO code: still show the number rather than crash a flow.
    return `${(cents / 100).toFixed(fractional ? 2 : 0)} ${currency}`;
  }
}
```

- [ ] **Step 4: Implement `src/features/rentals/pricing.ts`**

```ts
// Display-only mirror of the SQL money helpers in 0058
// (rental_total_cents / rental_deposit_cents). The RPCs are authoritative —
// this exists so flows, admin and emails can render the same numbers.
import { formatMoney } from "@/lib/money";
import { daysBetween, type RangeMode } from "./range";

export type PricingMode = "per_unit" | "flat";
export type DepositType = "none" | "fixed" | "percent" | "full";
export type MoneyFields = {
  priceCents: number | null;
  pricingMode: PricingMode;
  depositType: DepositType;
  depositValue: number | null;
};

// Units for nights/days stays; hours callers pass durationMin / 60 directly.
export function stayUnits(rangeMode: "nights" | "days", startDate: string, endDate: string): number {
  const n = daysBetween(startDate, endDate);
  return rangeMode === "nights" ? n : n + 1;
}

export function totalCents(m: MoneyFields, units: number): number | null {
  if (m.priceCents === null) return null;
  return m.pricingMode === "flat" ? m.priceCents : Math.round(m.priceCents * units);
}

export function depositCents(m: MoneyFields, total: number | null): number | null {
  switch (m.depositType) {
    case "none": return null;
    case "full": return total;
    case "percent":
      return total === null ? null : Math.round((total * (m.depositValue ?? 0)) / 100);
    case "fixed":
      if (m.depositValue === null) return null;
      return total === null ? m.depositValue : Math.min(m.depositValue, total);
  }
}

const UNIT_WORD: Record<RangeMode, string> = { hours: "hour", nights: "night", days: "day" };

export function formatOfferingPrice(
  o: { priceCents: number | null; pricingMode: PricingMode; rangeMode: RangeMode },
  currency: string,
): string | null {
  if (o.priceCents === null) return null;
  const amount = formatMoney(o.priceCents, currency);
  return o.pricingMode === "flat" ? amount : `${amount} / ${UNIT_WORD[o.rangeMode]}`;
}

export function formatCancelWindow(min: number): string {
  if (min % 1440 === 0) {
    const d = min / 1440;
    return `${d} ${d === 1 ? "day" : "days"}`;
  }
  const h = min / 60;
  const n = Number.isInteger(h) ? String(h) : String(Math.round(h * 10) / 10);
  return `${n} ${h === 1 ? "hour" : "hours"}`;
}

// Shared copy for the confirm step, the manage page and both emails.
export function moneyInfoLines(i: {
  totalCents: number | null;
  depositCents: number | null;
  currency: string | null;
  cancelWindowMin: number;
}): string[] {
  const lines: string[] = [];
  if (i.totalCents !== null && i.currency) lines.push(`Total: ${formatMoney(i.totalCents, i.currency)}`);
  if (i.depositCents !== null && i.currency) lines.push(`Deposit due: ${formatMoney(i.depositCents, i.currency)}`);
  if (lines.length > 0) lines.push("Payment: pay at the venue");
  if (i.cancelWindowMin > 0) lines.push(`Free cancellation until ${formatCancelWindow(i.cancelWindowMin)} before start`);
  return lines;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/money.test.ts src/features/rentals/pricing.test.ts`
Expected: PASS. If an `Intl` expectation differs only by space flavour (` ` vs ` `) or symbol placement, pin the test to the actual runtime output — the helper is right, the fixture was guessed.

- [ ] **Step 6: Verify and commit**

Run: `npm run verify`
```bash
git add src/lib/money.ts src/lib/money.test.ts src/features/rentals/pricing.ts src/features/rentals/pricing.test.ts
git commit -m "feat(rentals): money formatting + pricing display mirror (H3)"
```

---

### Task 2: Schema columns, migration 0057 + 0058 part A, data plumbing

**Files:**
- Modify: `src/db/schema/rentals.ts` (rentalOfferings: drop `priceLabel`, add six columns)
- Modify: `src/db/schema/orgs.ts` (orgs: add `currency`)
- Modify: `src/db/schema/scheduling.ts` (bookings: add four snapshot columns)
- Create (generated): `src/db/migrations/0057_*.sql` via `npm run db:generate`
- Create: `src/db/migrations/0058_prices_terms.sql` (part A: CHECKs, SQL money helpers, `update_org_scheduling`)
- Modify: `src/db/migrations/meta/_journal.json` (add 0058 entry)
- Modify: `src/features/rentals/schema.ts` (zod: swap `priceLabel` for the new fields, defaults only)
- Modify: `src/features/rentals/actions.ts` (`toOfferingRow`)
- Modify: `src/features/rentals/queries.ts` (`OfferingRow`, `OFFERING_COLUMNS`, `OfferingDb`, `toOffering`; add `getOrgCurrency`)
- Modify: `src/lib/booking/public.ts` (`PublicOffering`, `PUBLIC_OFFERING_COLUMNS`, `PublicOfferingDb`, `toPublicOffering`; `BookingOrg` + `getBookingOrg` gain `currency`)
- Modify: `src/features/rentals/components/offering-dialog.tsx`, `src/features/rentals/components/offerings-list.tsx`, `src/features/rentals/components/rental-booking-flow.tsx` (~line 150), `src/features/rentals/components/hourly-booking-flow.tsx` (~line 195), `src/features/scheduling/components/booking-widget.tsx` (~line 266) — **delete** the `priceLabel` input/display lines only (display returns in Tasks 4/6)
- Modify: `scripts/seed.ts` (rental offering seeds get money fields)
- Modify: `src/features/rentals/queries.integration.test.ts` / any test asserting `price_label` on rental offerings (adjust fixtures)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: DB columns exactly as in the spec table; TS names `priceCents`, `pricingMode`, `depositType`, `depositValue`, `cancelWindowMin`, `termsText` on `OfferingRow` and `PublicOffering`; `getOrgCurrency(): Promise<string>` in `src/features/rentals/queries.ts`; `BookingOrg.currency: string`; zod exports `PRICING_MODES`, `DEPOSIT_TYPES` from `src/features/rentals/schema.ts`; SQL functions `public.rental_total_cents(text, int, numeric) returns int` and `public.rental_deposit_cents(text, int, int) returns int`; `update_org_scheduling(uuid, text, text, text)`.

- [ ] **Step 1: Drizzle schema edits**

In `src/db/schema/rentals.ts` replace the `priceLabel` line with:

```ts
    // H3 money + policy (CHECKs in 0058). NULL price = unpriced offering —
    // every money surface collapses to the pre-H3 rendering.
    priceCents: integer("price_cents"),
    // 'per_unit' | 'flat' — per_unit reads hour/night/day from range_mode.
    pricingMode: text("pricing_mode").default("per_unit").notNull(),
    // 'none' | 'fixed' | 'percent' | 'full'.
    depositType: text("deposit_type").default("none").notNull(),
    // Cents (fixed) or whole percent 1–100 (percent); NULL otherwise.
    depositValue: integer("deposit_value"),
    // 0 = self-cancel until start. Stored minutes (min_notice_min idiom).
    cancelWindowMin: integer("cancel_window_min").default(0).notNull(),
    // House rules; public flows require a checkbox iff set.
    termsText: text("terms_text"),
```

In `src/db/schema/orgs.ts` after `timezone`:

```ts
  // H3: one settlement currency per org (H4 Stripe constraint). Whitelist
  // CHECK in 0058; written ONLY via update_org_scheduling.
  currency: text("currency").default("PLN").notNull(),
```

In `src/db/schema/scheduling.ts` `bookings`, after `note`:

```ts
    // H3 money snapshot, computed inside the rental RPCs at (re)booking
    // time. NULL for appointments and pre-H3 rows; historical record —
    // later offering/currency edits never rewrite it.
    priceCents: integer("price_cents"),
    currency: text("currency"),
    depositCents: integer("deposit_cents"),
    // Stamped by the public create RPCs iff the offering had terms_text;
    // carried forward across reschedules.
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
```

- [ ] **Step 2: Generate 0057**

Run: `npm run db:generate`
Expected: a new `src/db/migrations/0057_<name>.sql` containing only `alter table` add/drop column statements for the three tables (drop of `rental_offerings.price_label` included). Inspect it; no other tables may appear.

- [ ] **Step 3: Write 0058 part A**

Create `src/db/migrations/0058_prices_terms.sql`:

```sql
-- H3 prices & terms (part A): CHECKs, money helpers, org currency RPC.
-- Part B (booking RPC money snapshot + cancel window) is appended below in
-- a later task of the same slice.

-- ---------- CHECKs (columns added by 0057)
alter table public.rental_offerings
  add constraint rental_offerings_price_cents_ck
    check (price_cents is null or price_cents >= 0),
  add constraint rental_offerings_pricing_mode_ck
    check (pricing_mode in ('per_unit','flat')),
  add constraint rental_offerings_deposit_type_ck
    check (deposit_type in ('none','fixed','percent','full')),
  add constraint rental_offerings_deposit_value_ck check (
    case deposit_type
      when 'fixed'   then deposit_value is not null and deposit_value >= 0
      when 'percent' then deposit_value between 1 and 100
      else deposit_value is null
    end),
  -- percent/full are fractions of a price; fixed may stand alone
  -- ("free to book, damage deposit at the venue").
  add constraint rental_offerings_deposit_needs_price_ck
    check (deposit_type not in ('percent','full') or price_cents is not null),
  add constraint rental_offerings_cancel_window_ck
    check (cancel_window_min >= 0);

alter table public.orgs
  add constraint orgs_currency_ck
    check (currency in ('PLN','EUR','USD','GBP','CZK'));

alter table public.bookings
  add constraint bookings_money_ck
    check ((price_cents is null or price_cents >= 0)
       and (deposit_cents is null or deposit_cents >= 0));

-- ---------- Money helpers (mirrored by src/features/rentals/pricing.ts —
-- keep the two in lockstep). p_units: nights/days count, or duration/60.
create function public.rental_total_cents(p_mode text, p_price int, p_units numeric)
returns int language sql immutable as $$
  select case when p_price is null then null
              when p_mode = 'flat' then p_price
              else round(p_price * p_units)::int end;
$$;
revoke all on function public.rental_total_cents(text, int, numeric)
  from public, anon, authenticated;

create function public.rental_deposit_cents(p_type text, p_value int, p_total int)
returns int language sql immutable as $$
  select case p_type
           when 'full'    then p_total
           when 'percent' then case when p_total is null then null
                                    else round(p_total * p_value / 100.0)::int end
           when 'fixed'   then case when p_total is null then p_value
                                    else least(p_value, p_total) end
           else null end;
$$;
revoke all on function public.rental_deposit_cents(text, int, int)
  from public, anon, authenticated;

-- ---------- update_org_scheduling: + currency (signature change → drop).
drop function public.update_org_scheduling(uuid, text, text);
create function public.update_org_scheduling(
  p_org_id uuid,
  p_handle text,
  p_timezone text,
  p_currency text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then
    raise exception 'not found';
  end if;
  if p_handle is not null and p_handle !~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$' then
    raise exception 'not found';
  end if;
  if p_handle is not null and p_handle = any (public.reserved_handles()) then
    raise exception 'reserved handle';
  end if;
  if p_timezone is null
     or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'invalid timezone';
  end if;
  if p_currency is null or p_currency not in ('PLN','EUR','USD','GBP','CZK') then
    raise exception 'invalid currency';
  end if;
  select o.handle into v_old from public.orgs o where o.id = p_org_id for update;
  -- A handle another org once used is theirs for good. Surfaced as 23505 so
  -- the callers' "just taken" mapping covers it.
  if p_handle is not null and exists (
    select 1 from public.org_handle_history h where h.handle = p_handle and h.org_id <> p_org_id
  ) then
    raise exception 'handle taken' using errcode = 'unique_violation';
  end if;
  update public.orgs
    set handle = p_handle, timezone = p_timezone, currency = p_currency
    where id = p_org_id;
  if v_old is not null and v_old is distinct from p_handle then
    insert into public.org_handle_history (handle, org_id) values (v_old, p_org_id)
    on conflict (handle) do update set org_id = excluded.org_id, released_at = now();
  end if;
  -- Taking one of its own old handles back retires the history row.
  if p_handle is not null then
    delete from public.org_handle_history h where h.handle = p_handle and h.org_id = p_org_id;
  end if;
end;
$$;
revoke all on function public.update_org_scheduling(uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.update_org_scheduling(uuid, text, text, text) to authenticated;
```

- [ ] **Step 4: Register 0058 in the journal**

In `src/db/migrations/meta/_journal.json`, after the 0057 entry drizzle just added, append (comma-correct):

```json
    {
      "idx": 58,
      "version": "7",
      "when": <0057's "when" + 1000>,
      "tag": "0058_prices_terms",
      "breakpoints": true
    }
```

- [ ] **Step 5: TS plumbing — zod, row mappers, selects**

`src/features/rentals/schema.ts` — in `offeringCommon`, replace `priceLabel: ...` with (defaults only here; cross-field refinements come in Task 4 with the dialog):

```ts
export const PRICING_MODES = ["per_unit", "flat"] as const;
export const DEPOSIT_TYPES = ["none", "fixed", "percent", "full"] as const;
```
```ts
  priceCents: z.number().int().min(0).max(100_000_000).nullable().default(null),
  pricingMode: z.enum(PRICING_MODES).default("per_unit"),
  depositType: z.enum(DEPOSIT_TYPES).default("none"),
  depositValue: z.number().int().min(0).max(100_000_000).nullable().default(null),
  cancelWindowMin: z.number().int().min(0).max(527040).default(0),
  termsText: z.string().trim().max(10000).optional(),
```

`src/features/rentals/actions.ts` — in `toOfferingRow`'s `common`, replace `price_label: d.priceLabel ?? null,` with:

```ts
    price_cents: d.priceCents,
    pricing_mode: d.pricingMode,
    deposit_type: d.depositType,
    deposit_value: d.depositValue,
    cancel_window_min: d.cancelWindowMin,
    terms_text: d.termsText ?? null,
```

`src/features/rentals/queries.ts` — in `OfferingRow` replace `priceLabel: string | null;` with:

```ts
  priceCents: number | null;
  pricingMode: "per_unit" | "flat";
  depositType: "none" | "fixed" | "percent" | "full";
  depositValue: number | null;
  cancelWindowMin: number;
  termsText: string | null;
```

In `OFFERING_COLUMNS` replace `price_label` with `price_cents, pricing_mode, deposit_type, deposit_value, cancel_window_min, terms_text`; mirror in `OfferingDb` (snake_case, same types) and `toOffering` (camelCase mapping). Add at the bottom:

```ts
// The org's settlement currency for money display (single-org session).
export async function getOrgCurrency(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.from("orgs").select("currency").limit(1).maybeSingle();
  return (data as { currency: string } | null)?.currency ?? "PLN";
}
```

`src/lib/booking/public.ts` — same six-field swap in `PublicOffering` / `PUBLIC_OFFERING_COLUMNS` / `PublicOfferingDb` / `toPublicOffering`. In `BookingOrg` add `currency: string;`, in `getBookingOrg` add `currency` to the select and `currency: data.currency,` to the mapper.

- [ ] **Step 6: Delete the dead `priceLabel` display/input sites**

- `offering-dialog.tsx`: remove the Price label `<Label>/<Input>` block (~lines 160–167) and the `priceLabel` lines in its form-data assembly (~lines 68, 72).
- `offerings-list.tsx`: remove the `priceLabel` render (Task 4 restores a formatted price).
- `rental-booking-flow.tsx` ~150 and `hourly-booking-flow.tsx` ~195: remove the `offering.priceLabel` span (Task 6 restores).
- `booking-widget.tsx` ~266: remove `o.priceLabel` from the rental offering meta join (Task 6 restores).

- [ ] **Step 7: Seeds**

In `scripts/seed.ts`, extend the hourly rental offering insert (~line 588 area) with:

```ts
      price_cents: 12000,
      pricing_mode: "per_unit",
      deposit_type: "percent",
      deposit_value: 20,
      cancel_window_min: 1440,
      terms_text: "No smoking. Leave the room as you found it. Damages are billed at cost.",
```

(Only on the rental offering insert — `services` seeds keep `price_label`.)

- [ ] **Step 8: Reset, run everything**

Run: `npm run db:reset` (stack up first: `npm run supabase:start` if needed)
Run: `npm run verify && npm run test:integration`
Expected: PASS. Any test still selecting `price_label` from `rental_offerings` (check `queries.integration.test.ts`, flow tests' fixtures) gets its fixture updated to the new columns — do NOT re-add the column.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(rentals): H3 schema — offering money/policy columns, org currency, booking snapshot (0057+0058A)"
```

---

### Task 3: 0058 part B — RPC money snapshot, terms stamp, cancel window, resolver

**Files:**
- Modify: `src/db/migrations/0058_prices_terms.sql` (append part B)
- Create: `src/features/rentals/h3-money-rpc.integration.test.ts`
- Test also touches: none (SQL only + new test file)

**Interfaces:**
- Consumes: `rental_total_cents` / `rental_deposit_cents` (Task 2), the latest RPC bodies being replaced: `create_rental_booking` (0054:237), `create_rental_booking_admin` (0039:386), `create_rental_booking_hours` + `_admin` and `reschedule_rental_hours_apply` (0056), `reschedule_rental_apply` (0039:161), `cancel_booking` (0041:596), `resolve_booking_token` (0052).
- Produces: bookings rows carrying `price_cents/currency/deposit_cents/terms_accepted_at`; sentinel `'cancel_window'` from `cancel_booking`; `resolve_booking_token` returning four extra columns `price_cents int, currency text, deposit_cents int, cancel_window_min int` (appended AFTER `staff_name` — TS row types index by name, but keep order stable for sanity).

- [ ] **Step 1: Write the failing integration tests**

Create `src/features/rentals/h3-money-rpc.integration.test.ts`. Copy the file-scaffold conventions from `src/features/rentals/hourly-rpc.integration.test.ts`: the admin client setup, the org/offering/unit fixture helpers, `const d = (n: number) => addDaysISO(dateInZone(new Date(), TZ), n)`, and token-hash minting. Reuse those helpers' exact local names; the assertions to add:

```ts
// 1. hours create snapshots money + terms
//    offering: price_cents 12000 per_unit, deposit percent 20, terms set
//    create_rental_booking_hours for 90 min → booking row has
//    price_cents 18000, deposit_cents 3600, currency 'PLN',
//    terms_accepted_at not null.
// 2. admin hours create: same offering → money snapshotted,
//    terms_accepted_at IS null.
// 3. nights create (create_rental_booking, 3 nights at 10000/night,
//    deposit fixed 50000) → price_cents 30000, deposit_cents 30000 (capped).
// 4. days create (create_rental_booking_admin, days mode, 2026-09-01..03
//    via d(n), price 10000/day) → price_cents 30000 (inclusive count).
// 5. flat pricing: hours offering pricing_mode 'flat' price 50000,
//    120 min → price_cents 50000.
// 6. unpriced offering with deposit_type 'fixed' 20000 → price_cents null,
//    deposit_cents 20000, currency 'PLN'.
// 7. unpriced, deposit 'none' → all three money columns null.
// 8. reschedule recompute: nights booking made at price 10000, then
//    UPDATE rental_offerings SET price_cents = 20000, then
//    reschedule_rental_booking_admin to a longer range → NEW row's
//    price_cents reflects 20000 × new length; OLD row keeps its snapshot.
//    terms_accepted_at is carried onto the new row.
// 9. reschedule_rental_booking_hours (client token RPC): new row keeps the
//    same duration and re-snapshots at current offering price.
// 10. cancel window: hours booking starting d(1), offering
//     cancel_window_min = 2880 (2 days) → cancel_booking(p_token) raises
//     'cancel_window' (assert error.message contains 'cancel_window').
//     Booking stays 'confirmed'.
// 11. cancel outside window: window 60 min, booking d(2) →
//     cancel succeeds (status 'cancelled_by_client').
// 12. appointments unaffected: a service booking cancels fine regardless.
// 13. update_org_scheduling: p_currency 'EUR' persists; 'ZZZ' raises
//     'invalid currency'. Existing bookings' snapshot currency unchanged.
// 14. resolve_booking_token returns price_cents/currency/deposit_cents/
//     cancel_window_min for a rental booking; nulls + null window for an
//     appointment booking.
// 15. CHECK guards: insert offering with deposit_type 'percent' and
//     deposit_value 150 → rejected; 'percent' with price_cents null →
//     rejected; deposit_type 'none' with deposit_value 100 → rejected.
```

Write each as a real `it(...)` with actual `admin.rpc(...)`/`admin.from(...)` calls in the local helpers' style — the comment block above is the coverage list, not the test body.

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:integration -- src/features/rentals/h3-money-rpc.integration.test.ts`
Expected: FAIL — columns exist (0057) but RPCs don't write them, cancel doesn't gate, resolver lacks columns.

- [ ] **Step 3: Append part B to `0058_prices_terms.sql`**

For each function below, copy its **latest** body verbatim from the file/line in Interfaces, then apply only the listed deltas. `create_rental_booking_hours`, `create_rental_booking_hours_admin`, `reschedule_rental_hours_apply` were `create function` in 0056 — append `drop function` + `create function` (or `create or replace` keeping the identical signature; use `create or replace` for all six bodies since signatures don't change).

Common declare additions (all six): `v_total int; v_deposit int; v_snap_currency text;`

**`create_rental_booking`** (base: 0054):
- `v_org` select: add `o.currency` → `select o.id, o.timezone, o.currency, o.offers_rentals into v_org ...`
- After the `v_occ_end :=` line:
```sql
  v_total := public.rental_total_cents(v_off.pricing_mode, v_off.price_cents, v_len);
  v_deposit := public.rental_deposit_cents(v_off.deposit_type, v_off.deposit_value, v_total);
  v_snap_currency := case when v_total is not null or v_deposit is not null then v_org.currency end;
```
- Insert columns: `..., note, price_cents, currency, deposit_cents, terms_accepted_at)` with values `..., p_note, v_total, v_snap_currency, v_deposit, case when v_off.terms_text is not null then now() end)`.

**`create_rental_booking_admin`** (base: 0039): `v_off` select adds `o.currency as org_currency`; same three compute lines using `v_off.org_currency`; insert adds the three money columns and `null` for `terms_accepted_at` (walk-ins never accept terms — write the column explicitly with `null` so the intent is reviewable).

**`create_rental_booking_hours`** (base: 0056): `v_org` select adds `o.currency`; compute after `v_ends :=`:
```sql
  v_total := public.rental_total_cents(v_off.pricing_mode, v_off.price_cents, p_duration_min / 60.0);
```
then deposit/currency lines as above; insert adds the four columns with the terms `case` (public path stamps).

**`create_rental_booking_hours_admin`** (base: 0056): as the range admin — `o.currency as org_currency`, duration-based total, explicit `null` terms.

**`reschedule_rental_apply`** (base: 0039): `v_old` select adds `b.terms_accepted_at`; `v_org` select adds `o.currency`; compute after `v_occ_end :=` with `v_len`; new-row insert adds `price_cents, currency, deposit_cents, terms_accepted_at` valued `v_total, v_snap_currency, v_deposit, v_old.terms_accepted_at`.

**`reschedule_rental_hours_apply`** (base: 0056): same deltas, total from `v_duration / 60.0`.

**`cancel_booking`** — full replacement body (same signature/returns, so `create or replace`):

```sql
create or replace function public.cancel_booking(p_token text)
returns table (
  booking_id uuid, org_id uuid, org_name text, org_timezone text, service_name text, client_name text,
  client_email text, starts_at timestamptz, ends_at timestamptz, rental_unit_id uuid, staff_id uuid, staff_name text
) language plpgsql security definer set search_path = '' as $$
declare v_hash text; v_id uuid;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then return; end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  update public.bookings b set status = 'cancelled_by_client'
    where b.cancel_token_hash = v_hash and b.status = 'confirmed' and b.starts_at > now()
      -- H3: a rental inside its free-cancellation window cannot self-cancel.
      and (b.rental_offering_id is null or not exists (
        select 1 from public.rental_offerings ro
        where ro.id = b.rental_offering_id
          and ro.cancel_window_min > 0
          and now() > b.starts_at - make_interval(mins => ro.cancel_window_min)))
    returning b.id into v_id;
  if v_id is null then
    -- Distinguish "window passed" from a dead token so the manage page can
    -- say so (sentinel idiom: single lowercase word).
    if exists (
      select 1 from public.bookings b
      join public.rental_offerings ro on ro.id = b.rental_offering_id
      where b.cancel_token_hash = v_hash and b.status = 'confirmed' and b.starts_at > now()
        and ro.cancel_window_min > 0
        and now() > b.starts_at - make_interval(mins => ro.cancel_window_min)
    ) then
      raise exception 'cancel_window';
    end if;
    return;
  end if;
  return query
    select b.id, b.org_id, o.name, o.timezone, coalesce(s.name, ro.name || ' · ' || u.name),
           b.client_name, b.client_email, b.starts_at, b.ends_at, b.rental_unit_id, b.staff_id, st.name
    from public.bookings b
    join public.orgs o on o.id = b.org_id
    left join public.services s on s.id = b.service_id
    left join public.staff st on st.id = b.staff_id
    left join public.rental_offerings ro on ro.id = b.rental_offering_id
    left join public.rental_units u on u.id = b.rental_unit_id
    where b.id = v_id;
end; $$;
revoke all on function public.cancel_booking(text) from public, anon, authenticated, service_role;
grant execute on function public.cancel_booking(text) to service_role;
```

(Grant matches 0052's surface: service_role only.)

**`resolve_booking_token`** — return type changes, so:

```sql
drop function public.resolve_booking_token(text);
create function public.resolve_booking_token(p_token text)
returns table (
  booking_id uuid, booking_status text, starts_at timestamptz, ends_at timestamptz, service_name text,
  org_name text, org_timezone text, org_id uuid, service_id uuid, rental_unit_id uuid, range_mode text,
  staff_id uuid, staff_name text,
  price_cents int, currency text, deposit_cents int, cancel_window_min int
) language plpgsql security definer set search_path = '' as $$
declare v_hash text;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then return; end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  return query
    select b.id, b.status, b.starts_at, b.ends_at, coalesce(s.name, ro.name || ' · ' || u.name),
           o.name, o.timezone, b.org_id, b.service_id, b.rental_unit_id, ro.range_mode, b.staff_id, st.name,
           b.price_cents, b.currency, b.deposit_cents, ro.cancel_window_min
    from public.bookings b
    join public.orgs o on o.id = b.org_id
    left join public.services s on s.id = b.service_id
    left join public.staff st on st.id = b.staff_id
    left join public.rental_offerings ro on ro.id = b.rental_offering_id
    left join public.rental_units u on u.id = b.rental_unit_id
    where b.cancel_token_hash = v_hash
      and b.ends_at > now() - interval '30 days';
end; $$;
revoke all on function public.resolve_booking_token(text) from public, anon, authenticated, service_role;
grant execute on function public.resolve_booking_token(text) to anon, service_role;
```

- [ ] **Step 4: Reset and run the new suite**

Run: `npm run db:reset`
Run: `npm run test:integration -- src/features/rentals/h3-money-rpc.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Full integration + verify**

Run: `npm run test:integration && npm run verify`
Expected: PASS — existing rental/lifecycle suites must be green against the replaced RPCs (their inserts now also write snapshot columns; no existing assertion should break, fix fixtures only if one asserts full row shape).

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations/0058_prices_terms.sql src/features/rentals/h3-money-rpc.integration.test.ts
git commit -m "feat(rentals): H3 RPC money snapshot, terms stamp, cancel-window gate, resolver money (0058B)"
```

---

### Task 4: Admin — offering dialog pricing block, list price, zod refinements

**Files:**
- Modify: `src/features/rentals/schema.ts` (cross-field refinements + messages)
- Modify: `src/features/rentals/schema.test.ts` (new cases)
- Modify: `src/features/rentals/components/offering-dialog.tsx`
- Modify: `src/features/rentals/components/offerings-list.tsx`
- Modify: the rentals offerings page server component that renders them (find with `grep -rn "OfferingsList" src/app`) to fetch and pass `currency`
- Test: `src/features/rentals/schema.test.ts`

**Interfaces:**
- Consumes: `formatOfferingPrice` (Task 1), `getOrgCurrency` (Task 2), `PRICING_MODES`, `DEPOSIT_TYPES` (Task 2).
- Produces: `offeringInput`/`updateOfferingInput` reject bad money combos with exported messages `DEPOSIT_VALUE_MSG`, `DEPOSIT_NEEDS_PRICE_MSG`; `OfferingDialog` and `OfferingsList` accept a `currency: string` prop.

- [ ] **Step 1: Write failing zod tests** (extend `schema.test.ts`, following its existing style; base fixture = a valid hours offering)

```ts
it("rejects percent deposit outside 1–100", () => {
  expect(offeringInput.safeParse({ ...hoursBase, depositType: "percent", depositValue: 150, priceCents: 10000 }).success).toBe(false);
  expect(offeringInput.safeParse({ ...hoursBase, depositType: "percent", depositValue: 0, priceCents: 10000 }).success).toBe(false);
});
it("percent and full deposits require a price", () => {
  expect(offeringInput.safeParse({ ...hoursBase, depositType: "percent", depositValue: 20, priceCents: null }).success).toBe(false);
  expect(offeringInput.safeParse({ ...hoursBase, depositType: "full", priceCents: null }).success).toBe(false);
});
it("fixed deposit requires a value; none/full forbid one", () => {
  expect(offeringInput.safeParse({ ...hoursBase, depositType: "fixed", depositValue: null }).success).toBe(false);
  expect(offeringInput.safeParse({ ...hoursBase, depositType: "none", depositValue: 100 }).success).toBe(false);
  expect(offeringInput.safeParse({ ...hoursBase, depositType: "full", depositValue: 100, priceCents: 10000 }).success).toBe(false);
});
it("fixed deposit on an unpriced offering is allowed", () => {
  expect(offeringInput.safeParse({ ...hoursBase, priceCents: null, depositType: "fixed", depositValue: 20000 }).success).toBe(true);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/features/rentals/schema.test.ts`
Expected: the new cases FAIL (defaults-only schema accepts everything).

- [ ] **Step 3: Add the refinements**

In `schema.ts` next to the other messages:

```ts
export const DEPOSIT_VALUE_MSG =
  "fixed needs an amount, percent needs 1–100, none/full take no value";
export const DEPOSIT_NEEDS_PRICE_MSG = "percent/full deposits need a price";

const depositRules = (o: {
  depositType: "none" | "fixed" | "percent" | "full";
  depositValue: number | null;
}) => {
  switch (o.depositType) {
    case "fixed": return o.depositValue !== null;
    case "percent": return o.depositValue !== null && o.depositValue >= 1 && o.depositValue <= 100;
    default: return o.depositValue === null;
  }
};
const depositNeedsPrice = (o: {
  depositType: "none" | "fixed" | "percent" | "full";
  priceCents: number | null;
}) => !["percent", "full"].includes(o.depositType) || o.priceCents !== null;
```

Chain `.refine(depositRules, { message: DEPOSIT_VALUE_MSG }).refine(depositNeedsPrice, { message: DEPOSIT_NEEDS_PRICE_MSG })` onto **all four** union branches (`rangeOffering`, `hoursOffering`, and both `updateOfferingInput` branches) — zod refinements don't survive `.extend`, so they attach at each branch.

- [ ] **Step 4: Run to verify they pass** — `npx vitest run src/features/rentals/schema.test.ts`

- [ ] **Step 5: Dialog UI**

In `offering-dialog.tsx`, where the Price label block was (after Description), add a "Pricing & policies" section following the file's existing Label/Input/select patterns:

- Price: `<Input name="price" type="number" min={0} step="0.01">` in **major units**; empty = unpriced. Assemble as `priceCents: price === "" ? null : Math.round(Number(price) * 100)`.
- Pricing mode: the file's select idiom with options `per_unit` (label from `rangeMode` state: "Per hour" / "Per night" / "Per day") and `flat` ("Flat per booking").
- Deposit type select (`none/fixed/percent/full` with labels "No deposit" / "Fixed amount" / "Percent of total" / "Full amount"); when `fixed` show an amount input (major units → cents), when `percent` a 1–100 number input → `depositValue`; otherwise send `depositValue: null`.
- Cancellation window: number input labeled "Free cancellation until (hours before start)" for hours mode, "(days before start)" for nights/days; assemble `cancelWindowMin: hours × 60` or `days × 1440`; `0`/empty = no window. Derive the initial input value back from `offering?.cancelWindowMin` (`/60` or `/1440`).
- Terms: `<textarea name="termsText" rows={4}>` styled like the description field; empty → `undefined`.
- The dialog receives `currency: string` and shows it as the suffix on the price/deposit amount labels (e.g. `Price (PLN)`).

- [ ] **Step 6: List + page**

`offerings-list.tsx`: where `priceLabel` rendered, show `formatOfferingPrice(o, currency)` (skip the node when it returns null); component gains `currency: string`, passed down to `OfferingDialog`. In the offerings page server component add `const currency = await getOrgCurrency();` and pass it through.

- [ ] **Step 7: Verify + commit**

Run: `npm run verify`
Manual sanity (optional but cheap): `npm run dev`, open the worktree's dev port (:3001 — :3000 may serve another checkout, H2 lesson), create an offering with percent deposit, confirm it saves and lists "120 zł / hour".

```bash
git add -A && git commit -m "feat(rentals): H3 admin — pricing & policies editor, formatted list price, zod money rules"
```

---

### Task 5: Settings — org currency

**Files:**
- Modify: `src/features/scheduling/schema.ts` (`schedulingSettingsInput` gains `currency`)
- Modify: `src/features/scheduling/actions.ts` (`updateSchedulingSettings` passes `p_currency`)
- Modify: `src/features/scheduling/components/scheduling-settings-form.tsx` (currency select next to timezone)
- Modify: whatever server component feeds `settings` to that form (grep `SchedulingSettingsForm` usages) to include the org's `currency`
- Test: `src/features/scheduling/schema.test.ts`

**Interfaces:**
- Consumes: `CURRENCIES` from `src/lib/money.ts`; `update_org_scheduling(uuid, text, text, text)` from Task 2.
- Produces: `schedulingSettingsInput` requires `currency: z.enum(CURRENCIES)`; the settings form's `settings` prop type gains `currency: string`.

- [ ] **Step 1: Failing test** — in `scheduling/schema.test.ts` add:

```ts
it("scheduling settings require a whitelisted currency", () => {
  expect(schedulingSettingsInput.safeParse({ handle: "my-org", timezone: "Europe/Warsaw", currency: "PLN" }).success).toBe(true);
  expect(schedulingSettingsInput.safeParse({ handle: "my-org", timezone: "Europe/Warsaw", currency: "JPY" }).success).toBe(false);
  expect(schedulingSettingsInput.safeParse({ handle: "my-org", timezone: "Europe/Warsaw" }).success).toBe(false);
});
```

(Mirror the existing valid-fixture shape in that file — if `handle` is nullable there, keep it.)

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/features/scheduling/schema.test.ts`

- [ ] **Step 3: Implement**

- `schema.ts`: `currency: z.enum(CURRENCIES)` on `schedulingSettingsInput` (import `CURRENCIES` from `@/lib/money`).
- `actions.ts` (`updateSchedulingSettings`): add `p_currency: parsed.data.currency` to the RPC call.
- Form: add a labeled `<select>` (the form's existing control idiom) listing `CURRENCIES`, state-managed like `timezone` (`const [currency, setCurrency] = ...` seeded from `settings.currency`, included in `saved`/`dirty`, submitted with the rest). Label: "Currency". Helper text: "Shown on rental prices and deposits."
- Feed `currency` into the form's `settings` prop from its server component (extend that component's org select by `currency`).

- [ ] **Step 4: Run tests + verify** — `npx vitest run src/features/scheduling/schema.test.ts && npm run verify`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(scheduling): org currency setting (H3)"
```

---

### Task 6: Public flows — price display, summary block, terms checkbox

**Files:**
- Modify: `src/features/rentals/schema.ts` (`createRentalBookingInput` + `createRentalBookingHoursInput` gain `termsAccepted`; new `TERMS_REQUIRED` message)
- Modify: `src/features/rentals/public-actions.ts` (`createRentalBooking` enforces terms)
- Modify: `src/features/rentals/hourly-actions.ts` (`createRentalBookingHours` enforces terms)
- Create: `src/features/rentals/components/booking-money-summary.tsx`
- Modify: `src/features/rentals/components/rental-booking-flow.tsx`
- Modify: `src/features/rentals/components/hourly-booking-flow.tsx`
- Modify: `src/features/scheduling/components/booking-widget.tsx` (restore rental card price via `formatOfferingPrice`; pass `currency` to both flows)
- Modify: every other site that renders the two flows (grep `RentalBookingFlow\|HourlyBookingFlow` across `src/`) to pass `currency` from its org loader (`getBookingOrg().currency`)
- Test: `src/features/rentals/flow.integration.test.ts`, `src/features/rentals/hourly-flow.integration.test.ts`

**Interfaces:**
- Consumes: `PublicOffering` money fields + `BookingOrg.currency` (Task 2); `totalCents`, `depositCents`, `stayUnits`, `formatOfferingPrice`, `moneyInfoLines` (Task 1).
- Produces: `RentalBookingFlow`/`HourlyBookingFlow` props gain `currency: string`; `<BookingMoneySummary offering currency units termsAccepted onTermsChange />`; both create actions take `termsAccepted?: boolean` and refuse with `TERMS_REQUIRED` when the offering has terms and it isn't true.

- [ ] **Step 1: Failing action tests** — extend `flow.integration.test.ts` and `hourly-flow.integration.test.ts` (these run the server actions against the local stack; follow each file's existing setup):

```ts
// flow test additions (both files, adapted to range vs hours inputs):
// a) offering has terms_text and termsAccepted omitted → { ok: false }
//    with error === TERMS_REQUIRED, and no booking row is created.
// b) termsAccepted: true → ok; booking row has terms_accepted_at set.
// c) offering without terms_text and termsAccepted omitted → ok (no regression).
```

Run: `npm run test:integration -- src/features/rentals/flow.integration.test.ts src/features/rentals/hourly-flow.integration.test.ts`
Expected: new cases FAIL.

- [ ] **Step 2: Schema + actions**

`schema.ts`:

```ts
export const TERMS_REQUIRED = "Please accept the terms to book.";
```

Add `termsAccepted: z.boolean().default(false),` to `createRentalBookingInput` and `createRentalBookingHoursInput`.

In `createRentalBooking` (public-actions.ts), after the `getPublicOfferingById` null-check:

```ts
    if (offering.termsText !== null && !parsed.data.termsAccepted) {
      return { ok: false, error: TERMS_REQUIRED };
    }
```

Same guard in `createRentalBookingHours` (hourly-actions.ts) after its offering load. (The RPC stamps `terms_accepted_at` on its own — the action guard is the enforcement, the stamp is the record.)

- [ ] **Step 3: Run action tests to verify they pass** — same command as Step 1.

- [ ] **Step 4: `BookingMoneySummary` component**

```tsx
"use client";

import { moneyInfoLines, totalCents, depositCents, type MoneyFields } from "@/features/rentals/pricing";

// Confirm-step money block. `units` is nights/days count or durationMin/60;
// null while the picker hasn't settled. Renders nothing when the offering
// carries no money and no policy (pre-H3 rendering).
export function BookingMoneySummary(props: {
  offering: MoneyFields & { cancelWindowMin: number; termsText: string | null };
  currency: string;
  units: number | null;
  termsAccepted: boolean;
  onTermsChange: (v: boolean) => void;
}) {
  const total = props.units === null ? null : totalCents(props.offering, props.units);
  const deposit = depositCents(props.offering, total);
  const lines = moneyInfoLines({
    totalCents: total,
    depositCents: deposit,
    currency: props.currency,
    cancelWindowMin: props.offering.cancelWindowMin,
  });
  if (lines.length === 0 && props.offering.termsText === null) return null;
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
      {lines.map((l) => (
        <p key={l} className={l.startsWith("Total") ? "font-medium" : "text-muted-foreground"}>{l}</p>
      ))}
      {props.offering.termsText !== null ? (
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            required
            checked={props.termsAccepted}
            onChange={(e) => props.onTermsChange(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            I accept the terms
            <details className="mt-1">
              <summary className="text-muted-foreground cursor-pointer text-xs">Show terms</summary>
              <p className="text-muted-foreground text-xs whitespace-pre-wrap">{props.offering.termsText}</p>
            </details>
          </span>
        </label>
      ) : null}
    </div>
  );
}
```

(Match the flows' existing class vocabulary; if they use a shared Checkbox component, use that instead of the raw input.)

- [ ] **Step 5: Wire the flows**

Both flows: add `currency: string` prop; restore the offering-card price line as
`{formatOfferingPrice(offering, currency) ? <span className="text-muted-foreground shrink-0 text-xs">{formatOfferingPrice(offering, currency)}</span> : null}`
(compute once into a variable). Add `const [termsAccepted, setTermsAccepted] = React.useState(false)`; render `<BookingMoneySummary ... />` inside the confirm/details step above the submit button with `units` = `stayUnits(offering.rangeMode as "nights" | "days", startDate, endDate)` for the range flow (that flow never receives an hours offering — same cast rationale as Task 8's email wiring; only when both dates are picked) and `durationMin / 60` for the hourly flow; pass `termsAccepted` into the create-action payload. Reset `termsAccepted` wherever the flow resets its picker state. `booking-widget.tsx` ~266: restore the rental meta entry with `formatOfferingPrice(o, currency)`. Thread `currency` from each surface's org data (`getBookingOrg` already returns it; grep every `<RentalBookingFlow`/`<HourlyBookingFlow` site and the widget's data loader).

- [ ] **Step 6: Verify + integration + commit**

Run: `npm run verify && npm run test:integration`

```bash
git add -A && git commit -m "feat(rentals): H3 public flows — price display, money summary, terms acceptance"
```

---

### Task 7: Manage page — money lines + cancel-window gate

**Files:**
- Modify: `src/lib/tokens/booking.ts` (resolver row + type gain the four columns)
- Modify: `src/app/booking/[token]/page.tsx`
- Modify: `src/features/scheduling/components/manage-booking.tsx` (new `canCancel` prop)
- Modify: `src/features/scheduling/manage-actions.ts` (`cancelBooking` maps the sentinel)
- Modify: `src/features/rentals/schema.ts` (message constant)
- Test: covered by Task 3's RPC tests; UI change is compile + existing flow tests

**Interfaces:**
- Consumes: `resolve_booking_token` new columns (Task 3), `moneyInfoLines` (Task 1), `isRpcSentinel` contract.
- Produces: `ResolveBookingResult` booking gains `priceCents: number | null; currency: string | null; depositCents: number | null; cancelWindowMin: number | null;`; `CANCEL_WINDOW_PASSED` message in `rentals/schema.ts`; `ManageBooking` prop `canCancel: boolean`.

- [ ] **Step 1: Resolver fields**

In `src/lib/tokens/booking.ts` add to the result type, the raw-row type (`price_cents: number | null; currency: string | null; deposit_cents: number | null; cancel_window_min: number | null;`) and the mapper (`priceCents: row.price_cents, currency: row.currency, depositCents: row.deposit_cents, cancelWindowMin: row.cancel_window_min`).

- [ ] **Step 2: Sentinel mapping**

`rentals/schema.ts`:

```ts
export const CANCEL_WINDOW_PASSED =
  "The free-cancellation window has passed — contact the venue to cancel.";
```

In `manage-actions.ts` `cancelBooking`, inside the `if (error)` branch before the generic fallback (mirroring how other sentinels are matched in this codebase — check `isRpcSentinel` usage in `rentals/manage-actions.ts` and use the same call shape):

```ts
      if (isRpcSentinel(error, "cancel_window")) {
        return { ok: false, error: CANCEL_WINDOW_PASSED };
      }
```

- [ ] **Step 3: Page + component**

`src/app/booking/[token]/page.tsx`:

```tsx
  const infoLines = moneyInfoLines({
    totalCents: b.priceCents,
    depositCents: b.depositCents,
    currency: b.currency,
    cancelWindowMin: b.cancelWindowMin ?? 0,
  });
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const isInFuture = b.startsAt.getTime() > now;
  const canCancel =
    b.rentalUnitId === null ||
    !b.cancelWindowMin ||
    now <= b.startsAt.getTime() - b.cancelWindowMin * 60_000;
```

Render `infoLines` inside the booking card after the when-line (`infoLines.map((l) => <p key={l} className="text-muted-foreground">{l}</p>)`), and pass `canCancel={canCancel}` to `ManageBooking`.

`manage-booking.tsx`: add `canCancel: boolean` to props; when false, hide the cancel button and render
`<p className="text-muted-foreground text-xs">{CANCEL_WINDOW_PASSED}</p>`
(reschedule stays available; the RPC gate is the backstop if the window elapses between render and click).

- [ ] **Step 4: Verify + commit**

Run: `npm run verify && npm run test:integration`

```bash
git add -A && git commit -m "feat(rentals): H3 manage page — money lines, cancel-window gating"
```

---

### Task 8: Emails — money lines on confirmations

**Files:**
- Modify: `src/features/scheduling/templates.ts` (`bookingConfirmationEmail` + `providerNewBookingEmail` gain `infoLines?: string[]`)
- Modify: `src/features/scheduling/templates.test.ts` (new cases)
- Modify: `src/features/rentals/public-actions.ts` (client confirmation gets lines)
- Modify: `src/features/rentals/hourly-actions.ts` (client confirmation ~line 222 + provider notice ~line 250 get lines)

**Interfaces:**
- Consumes: `moneyInfoLines`, `totalCents`, `depositCents`, `stayUnits` (Task 1); `PublicOffering` money fields + `BookingOrg.currency` (Task 2).
- Produces: both templates accept optional `infoLines`; rentals confirmation/provider mails carry Total / Deposit due / pay-at-venue / cancellation-policy lines.

- [ ] **Step 1: Failing template tests** — in `templates.test.ts` (matching its existing assertion style):

```ts
it("bookingConfirmationEmail renders infoLines in html and text", () => {
  const msg = bookingConfirmationEmail({
    orgName: "Org", serviceName: "Studio · Room 1", whenLine: "Mon", manageUrl: "https://x/m", icsUrl: "https://x/i",
    infoLines: ["Total: 300 zł", "Payment: pay at the venue"],
  });
  expect(msg.html).toContain("Total: 300 zł");
  expect(msg.text).toContain("Payment: pay at the venue");
});
it("omits the block when infoLines is absent", () => {
  const msg = bookingConfirmationEmail({
    orgName: "Org", serviceName: "S", whenLine: "Mon", manageUrl: "https://x/m", icsUrl: "https://x/i",
  });
  expect(msg.html).not.toContain("Total:");
});
```

Plus the mirror case for `providerNewBookingEmail`. Run `npx vitest run src/features/scheduling/templates.test.ts` — new cases FAIL.

- [ ] **Step 2: Template change**

Add `infoLines?: string[]` to both input types. In `bookingConfirmationEmail` html, after the whenLine paragraph insert:

```ts
${(input.infoLines ?? []).map((l) => `\n  <p style="margin: 0 0 4px; color: #444;">${esc(l)}</p>`).join("")}
```

and in the text array after `input.whenLine`: `...(input.infoLines ?? []),`. Same insertion points in `providerNewBookingEmail` (after its when/booking line — read the body and keep its layout).

- [ ] **Step 3: Run template tests** — PASS.

- [ ] **Step 4: Wire the senders**

`public-actions.ts` (range confirmation, inside the existing best-effort try): before `bookingConfirmationEmail({...})` compute

```ts
      const total = totalCents(ctx.offering, stayUnits(ctx.offering.rangeMode as "nights" | "days", startDate, endDate));
      const infoLines = moneyInfoLines({
        totalCents: total,
        depositCents: depositCents(ctx.offering, total),
        currency: org.currency,
        cancelWindowMin: ctx.offering.cancelWindowMin,
      });
```

and pass `infoLines` into the template input. `hourly-actions.ts`: same with `durationMin / 60` as units, for both the client confirmation and the provider notice. (The TS mirror matches the RPC snapshot by construction — Task 1 tests + Task 3 SQL tests pin both sides.)

- [ ] **Step 5: Verify + commit**

Run: `npm run verify && npm run test:integration`

```bash
git add -A && git commit -m "feat(rentals): H3 emails — money + policy lines on confirmations"
```

---

### Task 9: Final sweep — graph, full runs, PR

**Files:**
- Modify: none expected (fix-ups only)

- [ ] **Step 1: Full local runs**

Run: `npm run db:reset && npm run verify && npm run test:integration`
Expected: everything green from a clean database (proves migrations + seeds cohere).

- [ ] **Step 2: Browser QA on the worktree port**

`npm run dev` (worktree lands on :3001 — never QA :3000, H2 lesson). Walk: Settings → currency select saves; offering dialog → percent deposit + terms save; public hourly flow → card shows "120 zł / hour", confirm step shows Total/Deposit/pay-at-venue/policy + required checkbox, booking succeeds; manage link shows the money lines; a booking inside its window shows the contact-the-venue copy instead of the cancel button; Mailpit (:54354) confirmation shows the money lines.

- [ ] **Step 3: Update the knowledge graph**

Run: `graphify update .`

- [ ] **Step 4: Commit any fix-ups, push, open PR**

```bash
git push -u origin feat/h3-prices
gh pr create --title "feat(rentals): H3 — prices, deposits, cancellation window, terms (no Stripe)" --body "…spec: docs/superpowers/specs/2026-08-24-h3-prices-terms-design.md; migrations 0057+0058; H4 shifts to 0059.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

(Compose the PR body from the spec's Rulings + Data model sections; list deferred follow-ups discovered en route.)
