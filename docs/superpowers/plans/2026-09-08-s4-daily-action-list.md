# S4 Daily Action List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Overview page opens with one list of what still needs a human — requests waiting, holds expiring within 24 h, balances due on sessions that ended in the last 30 days — with the one-call actions inline, and every member gets the same list once a day at 08:00 org-local time as an email + push digest through the existing notification seam.

**Architecture:** Migration 0083 adds `orgs.digest_sent_on`, an org-gated `list_balances_due` RPC (balance via the S7 SQL formula, bounded to 30 days), a service-role `digest_due_orgs()` RPC (the 08:00-local + stamp test in SQL) and re-creates the member-prefs validator with a fifth event. One loader `loadDailyList(db, orgId, fallbackTitle, now)` serves both the Overview page (user client) and a fifth drain phase `runDailyDigest` (admin client), which claims each due org by stamping its local date and calls `notifyMembers` with a new `dailyDigest` notice. The Overview mounts a `DailyList` above the year heatmap; its rows reuse the requests inbox's row shell and the S7 server actions.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase (SQL `security definer` RPCs, RLS, hand-written migrations under `src/db/migrations` + Drizzle journal/snapshot), zod 4, next-intl (en/uk/pl parity test), the PR #128 notification seam (`notifyMembers`, Web Push), the 15-minute Cloudflare-driven drain (`POST /api/scheduling/drain`), Vitest unit + `vitest.integration.config.ts` against the local Supabase stack.

**Spec:** `docs/superpowers/specs/2026-09-08-s4-daily-action-list-design.md`

## Global Constraints

- Migration `0083_daily_list.sql`, journal idx 83, snapshot `0083_snapshot.json` (copy of 0082's + the one column). Additive only → normal deploy order. Next free after this slice: 0084.
- Windows and caps are constants, not settings: holds `now + 24 h`; balances `ends_at ≥ now − 30 days`, `status = 'confirmed'`, `ends_at ≤ now`, balance > 0; every list capped at 50; digest hour `08` org-local (SQL literal and TS `DIGEST_LOCAL_HOUR = 8` must match); digest batch 25 orgs per tick.
- The balance is never re-derived in TS for a list — `list_balances_due` calls `booking_balance_cents` (0082) in SQL.
- `digest_due_orgs()` is service-role only; `list_balances_due` admits members of the org (`user_orgs()`) or the service role, and returns zero rows to anyone else (no exception).
- A failed digest send is NOT retried the same day (the stamp stands). Logged with a `[digest]` prefix.
- The list leads the Overview page (spec ruling 4); an empty section renders nothing; when all three are empty the heatmap is first.
- i18n: every new key in `messages/en.json`, `uk.json`, `pl.json`; `src/i18n/messages.test.ts` enforces parity, ICU validity, plural categories and forbidden words (en: rental/offering/skip; uk: оренда/офер/пропустити; pl: wynaj/pomiń). Terms: uk deposit = передоплата, hold = утримане бронювання, request = запит; pl deposit = zaliczka, hold = rezerwacja wstrzymana, request = prośba.
- Commands: unit `npm test -- <file>`; integration `npm run test:integration -- <file>` (needs `supabase start` / `npm run setup`; `fileParallelism: false` already); migrations `npm run db:migrate` (a migration edited after applying → `npm run db:reset`); `npm run verify` = lint + typecheck + unit.
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01HwfEz5zNxoUcCZgEVGz8a5
  ```
- Branch: `feat/s4-daily-list` (already exists, spec committed on it).

---

## File structure

| File | Responsibility |
|---|---|
| `src/db/migrations/0083_daily_list.sql` (new), `meta/_journal.json`, `meta/0083_snapshot.json` (new), `src/db/schema/orgs.ts` | Column, two RPCs, validator re-create. |
| `src/features/notifications/prefs.ts`, `prefs.test.ts` | Fifth member event + parity test re-pointed at 0083. |
| `src/features/scheduling/templates.ts` | `DigestRow` type + `dailyDigestEmail`. |
| `src/features/notifications/notify.ts`, `notify.test.ts` | `dailyDigest` notice variant, email/push rendering. |
| `src/features/scheduling/daily-list.ts` (new), `daily-list.integration.test.ts` (new) | The one loader (requests / holds / balances). |
| `src/features/scheduling/queries.ts` | `listPendingRequests` deleted (body moves to the loader). |
| `src/features/scheduling/components/requests-inbox.tsx` | `ActionRow` shell extracted from `RequestRow`. |
| `src/features/scheduling/components/daily-list.tsx` (new) | `DailyList`, `HoldsExpiring`, `BalancesDue`, `WriteOffDialog`. |
| `src/app/(dashboard)/overview/page.tsx` | Loader + `hasActivePaymentAccount`, `DailyList` mounted first. |
| `src/features/notifications/digest.ts` (new), `digest.integration.test.ts` (new) | `runDailyDigest` drain phase. |
| `src/app/api/scheduling/drain/route.ts` | Phase 5 wiring. |
| `messages/en.json`, `uk.json`, `pl.json` | `overview.*`, `emails.digest.*`, `emails.push.dailyDigest.*`, `notifications.events.dailyDigest`. |

---

### Task 1: Migration 0083 — column, two RPCs, validator

**Files:**
- Create: `src/db/migrations/0083_daily_list.sql`, `src/db/migrations/meta/0083_snapshot.json`
- Modify: `src/db/migrations/meta/_journal.json`, `src/db/schema/orgs.ts:44-48`
- Test: `src/features/notifications/prefs.test.ts` (parity), integration coverage lands in Task 3 and Task 5

**Interfaces:**
- Produces: `public.list_balances_due(p_org_id uuid, p_since timestamptz, p_limit int default 50) returns table (id uuid, balance_cents int)`; `public.digest_due_orgs() returns table (id uuid, name text, timezone text, locale text, local_date date)`; `orgs.digest_sent_on date null`; `update_member_notification_prefs` accepting `dailyDigest`.

- [ ] **Step 1: Write the migration**

`src/db/migrations/0083_daily_list.sql`:

```sql
-- S4 daily action list (spec 2026-09-08-s4-daily-action-list-design.md).
-- Additive: one column, two read RPCs, the member-prefs validator re-created
-- with a fifth event. Normal deploy order.

-- ---------- orgs.digest_sent_on: the org-local date of the last digest
-- claim. Null = never sent, so every existing org is due at its next 08:00.
alter table public.orgs add column digest_sent_on date;
--> statement-breakpoint

-- ---------- list_balances_due: ended, confirmed bookings of ONE org that
-- still owe money, by the 0082 formula (never re-derived in TS for a list).
-- Gate: a member of the org or the service role; anyone else gets no rows.
-- Bounded by p_since (the app passes now − 30 days, spec ruling 6).
create function public.list_balances_due(p_org_id uuid, p_since timestamptz, p_limit int default 50)
returns table (id uuid, balance_cents int)
language sql stable security definer set search_path = '' as $$
  select s.id, s.balance_cents from (
    select b.id, b.ends_at, public.booking_balance_cents(b.id) as balance_cents
    from public.bookings b
    where b.org_id = p_org_id
      and (auth.role() = 'service_role' or p_org_id in (select public.user_orgs()))
      and b.status = 'confirmed'
      and b.ends_at <= now()
      and b.ends_at >= p_since
  ) s
  where s.balance_cents > 0
  order by s.ends_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;
--> statement-breakpoint
revoke all on function public.list_balances_due(uuid, timestamptz, int) from public, anon, authenticated, service_role;
--> statement-breakpoint
grant execute on function public.list_balances_due(uuid, timestamptz, int) to authenticated, service_role;
--> statement-breakpoint

-- ---------- digest_due_orgs: which orgs are past 08:00 local time and not
-- yet stamped for their local date. The hour is mirrored by
-- DIGEST_LOCAL_HOUR in src/features/notifications/digest.ts (ruling 8/11).
create function public.digest_due_orgs()
returns table (id uuid, name text, timezone text, locale text, local_date date)
language sql stable security definer set search_path = '' as $$
  select o.id, o.name, o.timezone, o.locale,
         (now() at time zone o.timezone)::date as local_date
  from public.orgs o
  where extract(hour from now() at time zone o.timezone) >= 8
    and (o.digest_sent_on is null or o.digest_sent_on < (now() at time zone o.timezone)::date)
  order by o.digest_sent_on nulls first, o.id
  limit 25;
$$;
--> statement-breakpoint
revoke all on function public.digest_due_orgs() from public, anon, authenticated, service_role;
--> statement-breakpoint
grant execute on function public.digest_due_orgs() to service_role;
--> statement-breakpoint

-- ---------- update_member_notification_prefs: 0075's body with
-- 'dailyDigest' admitted. Shape mirrors memberPrefsSchema (prefs.ts);
-- prefs.test.ts asserts the two lists agree.
create or replace function public.update_member_notification_prefs(p_org_id uuid, p_prefs jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_val jsonb;
begin
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then
    raise exception 'not found';
  end if;
  if p_prefs is not null then
    if jsonb_typeof(p_prefs) <> 'object' then raise exception 'not found'; end if;
    for v_key, v_val in select * from jsonb_each(p_prefs) loop
      if v_key not in ('newBooking', 'newRequest', 'cancelled', 'rescheduled', 'dailyDigest') then
        raise exception 'not found';
      end if;
      if jsonb_typeof(v_val) <> 'object'
         or jsonb_typeof(v_val -> 'email') is distinct from 'boolean'
         or jsonb_typeof(v_val -> 'push') is distinct from 'boolean' then
        raise exception 'not found';
      end if;
    end loop;
  end if;
  update public.org_members
     set notification_prefs = p_prefs
   where org_id = p_org_id and user_id = (select auth.uid());
end;
$$;
--> statement-breakpoint
revoke all on function public.update_member_notification_prefs(uuid, jsonb) from public, anon, authenticated, service_role;
--> statement-breakpoint
grant execute on function public.update_member_notification_prefs(uuid, jsonb) to authenticated;
```

- [ ] **Step 2: Journal, snapshot, Drizzle**

Append to `src/db/migrations/meta/_journal.json` `entries`:

```json
    {
      "idx": 83,
      "version": "7",
      "when": 1789100000000,
      "tag": "0083_daily_list",
      "breakpoints": true
    }
```

Snapshot: `cp src/db/migrations/meta/0082_snapshot.json src/db/migrations/meta/0083_snapshot.json`, then in the copy set a new `"id"` (any fresh uuid), `"prevId"` = 0082's `id`, and add to `public.orgs.columns`:

```json
        "digest_sent_on": {
          "name": "digest_sent_on",
          "type": "date",
          "primaryKey": false,
          "notNull": false
        }
```

Functions are not tracked in snapshots (0082's RPCs are absent from its snapshot — keep it that way).

`src/db/schema/orgs.ts`, after `notificationPrefs`:

```ts
  // S4: org-local date of the last morning-digest claim (digest_due_orgs /
  // runDailyDigest). Null = never sent. Written by the drain only.
  digestSentOn: date("digest_sent_on"),
```

and add `date` to the `drizzle-orm/pg-core` import on line 1.

- [ ] **Step 3: Apply**

Run: `npm run db:migrate`
Expected: `0083_daily_list` applied, no error. Then `npm run typecheck` → clean.

- [ ] **Step 4: Re-point the prefs parity test and make it fail**

In `src/features/notifications/prefs.test.ts`, inside `describe("lead set parity with the migration")`, add:

```ts
  it("MEMBER_EVENTS equals the key list inside update_member_notification_prefs (0083)", () => {
    const sql = readFileSync(join(process.cwd(), "src/db/migrations/0083_daily_list.sql"), "utf8");
    const hit = /if v_key not in \(([^)]+)\)/.exec(sql);
    expect(hit, "member key CHECK not found").not.toBeNull();
    const inSql = hit![1].split(",").map((k) => k.trim().replace(/^'|'$/g, "")).sort();
    expect(inSql).toEqual([...MEMBER_EVENTS].sort());
  });
```

Add `MEMBER_EVENTS` to the import from `./prefs`.

Run: `npm test -- src/features/notifications/prefs.test.ts`
Expected: FAIL — SQL has 5 keys, `MEMBER_EVENTS` has 4 (Task 2 fixes the TS side).

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations/0083_daily_list.sql src/db/migrations/meta/_journal.json src/db/migrations/meta/0083_snapshot.json src/db/schema/orgs.ts src/features/notifications/prefs.test.ts
git commit -m "feat(db): 0083 daily list — digest_sent_on, list_balances_due, digest_due_orgs, dailyDigest pref (S4)"
```

---

### Task 2: `dailyDigest` member event — prefs, template, notify

**Files:**
- Modify: `src/features/notifications/prefs.ts:10-32`, `src/features/scheduling/templates.ts` (append), `src/features/notifications/notify.ts:26-67, 88-119, 133`, `messages/en.json`, `messages/uk.json`, `messages/pl.json`
- Test: `src/features/notifications/notify.test.ts`, `src/features/notifications/prefs.test.ts`, `src/i18n/messages.test.ts`

**Interfaces:**
- Produces: `MEMBER_EVENTS` includes `"dailyDigest"`; `export type DigestRow = { clientName: string; whenLine: string; note: string }` (in `templates.ts`); `dailyDigestEmail(t, { requests, holds, balances, overviewUrl })`; `MemberNotice` variant `{ event: "dailyDigest"; requests: DigestRow[]; holds: DigestRow[]; balances: DigestRow[] }`; `pushUrlFor("dailyDigest") === "/overview"`.

- [ ] **Step 1: Write the failing notify tests**

Append to `src/features/notifications/notify.test.ts` (inside `describe("notifyMembers")`):

```ts
  const digest = {
    orgId: "org1",
    event: "dailyDigest" as const,
    idempotencyKey: "digest:org1:2026-09-08",
    requests: [{ clientName: "Anna", whenLine: "Mon 10:00–12:00", note: "Studio A" }],
    holds: [{ clientName: "Ola", whenLine: "Tue 14:00–16:00", note: "50,00 zł deposit, until Mon, 16:00" }],
    balances: [
      { clientName: "Piotr", whenLine: "Sun 09:00–11:00", note: "120,00 zł due" },
      { clientName: "Kasia", whenLine: "Sat 18:00–20:00", note: "30,00 zł due" },
    ],
  };

  it("dailyDigest → one email with the three sections, no reply-to; push counts the rows and lands on /overview", async () => {
    const h = harness([{ user_id: "u1", email: "owner@example.com", notification_prefs: null }]);
    await notifyMembers(digest, h.deps);
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0].subject).toBe("4 things need you today");
    expect(h.emails[0].replyTo).toBeUndefined();
    expect(h.emails[0].idempotencyKey).toBe("digest:org1:2026-09-08");
    expect(h.emails[0].text).toContain("Requests waiting (1)");
    expect(h.emails[0].text).toContain("Holds expiring soon (1)");
    expect(h.emails[0].text).toContain("Balances due (2)");
    expect(h.emails[0].text).toContain("Piotr — Sun 09:00–11:00 — 120,00 zł due");
    expect(h.emails[0].html).toContain("<strong>Anna</strong>");
    expect(h.pushes).toEqual([
      { userId: "u1", payload: { title: "Your morning list", body: "4 things need you today", url: "/overview", tag: "digest:org1:2026-09-08" } },
    ]);
  });

  it("dailyDigest respects the member's own row in the matrix", async () => {
    const h = harness([{ user_id: "u1", email: "owner@example.com", notification_prefs: { dailyDigest: { email: false, push: true } } }]);
    await notifyMembers(digest, h.deps);
    expect(h.emails).toEqual([]);
    expect(h.pushes).toHaveLength(1);
  });

  it("dailyDigest with one row uses the singular", async () => {
    const h = harness([{ user_id: "u1", email: "owner@example.com", notification_prefs: null }]);
    await notifyMembers({ ...digest, requests: [], holds: [], balances: [digest.balances[0]] }, h.deps);
    expect(h.emails[0].subject).toBe("1 thing needs you today");
    expect(h.emails[0].text).not.toContain("Requests waiting");
  });
```

Also in `prefs.test.ts` the existing `parseMemberPrefs` default test — add one case:

```ts
  it("a four-key row written before S4 gets the dailyDigest default", () => {
    const prefs = parseMemberPrefs({ newBooking: { email: false, push: false } });
    expect(prefs.dailyDigest).toEqual({ email: true, push: true });
  });
```

Run: `npm test -- src/features/notifications`
Expected: FAIL (type errors on `event: "dailyDigest"`, missing `dailyDigest` key).

- [ ] **Step 2: prefs.ts**

Replace lines 10–32 of `src/features/notifications/prefs.ts`:

```ts
export const MEMBER_EVENTS = ["newBooking", "newRequest", "cancelled", "rescheduled", "dailyDigest"] as const;
export type MemberEvent = (typeof MEMBER_EVENTS)[number];
export type Channel = "email" | "push";
export type ChannelPrefs = Record<Channel, boolean>;
export type MemberPrefs = Record<MemberEvent, ChannelPrefs>;

const channelPrefsSchema = z.object({ email: z.boolean(), push: z.boolean() });

export const memberPrefsSchema = z.object({
  newBooking: channelPrefsSchema,
  newRequest: channelPrefsSchema,
  cancelled: channelPrefsSchema,
  rescheduled: channelPrefsSchema,
  // S4: the 08:00 morning list (requests, holds expiring, balances due).
  dailyDigest: channelPrefsSchema,
}) satisfies z.ZodType<MemberPrefs>;

/** Email is today's behaviour; push is on so the first enabled device just
    works. Nothing is sent on a channel the member has no address/device for. */
export const DEFAULT_MEMBER_PREFS: MemberPrefs = Object.freeze({
  newBooking: { email: true, push: true },
  newRequest: { email: true, push: true },
  cancelled: { email: true, push: true },
  rescheduled: { email: true, push: true },
  dailyDigest: { email: true, push: true },
}) as MemberPrefs;
```

Update the header comment's "exactly the four events" wording to "the five events" (line 5–8 and the 0075 comment reference → "0075/0083").

- [ ] **Step 3: templates.ts — `DigestRow` + `dailyDigestEmail`**

Append to `src/features/scheduling/templates.ts`:

```ts
// ---------- S4 morning digest (members). Rows arrive pre-formatted in the
// org's locale/timezone (features/notifications/digest.ts); this only lays
// them out. A section with no rows is omitted, in html and text alike.
export type DigestRow = { clientName: string; whenLine: string; note: string };

export function dailyDigestEmail(t: EmailsT, input: {
  requests: DigestRow[];
  holds: DigestRow[];
  balances: DigestRow[];
  overviewUrl: string;
}): { subject: string; html: string; text: string } {
  const count = input.requests.length + input.holds.length + input.balances.length;
  const subject = t("digest.subject", { count });
  const sections: Array<[string, DigestRow[]]> = [
    [t("digest.requests", { count: input.requests.length }), input.requests],
    [t("digest.holds", { count: input.holds.length }), input.holds],
    [t("digest.balances", { count: input.balances.length }), input.balances],
  ].filter(([, rows]) => rows.length > 0) as Array<[string, DigestRow[]]>;
  const sectionHtml = sections
    .map(
      ([heading, rows]) =>
        `\n  <p style="margin: 16px 0 4px; font-weight: 600;">${esc(heading)}</p>` +
        rows
          .map(
            (r) =>
              `\n  <p style="margin: 0 0 4px;"><strong>${esc(r.clientName)}</strong> — ${esc(r.whenLine)} — <span style="color: #444;">${esc(r.note)}</span></p>`,
          )
          .join(""),
    )
    .join("");
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <p style="margin: 0 0 8px;">${esc(t("digest.lead"))}</p>${sectionHtml}
  <p style="margin: 24px 0 0;"><a href="${esc(input.overviewUrl)}">${esc(t("digest.open"))}</a></p>
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">${esc(t("digest.footer"))}</p>
</div>`.trim();
  const text = [
    t("digest.lead"),
    ...sections.flatMap(([heading, rows]) => ["", heading, ...rows.map((r) => `${r.clientName} — ${r.whenLine} — ${r.note}`)]),
    "",
    t("digest.openText", { url: input.overviewUrl }),
    "",
    t("digest.footer"),
  ].join("\n");
  return { subject, html, text };
}
```

- [ ] **Step 4: notify.ts**

Imports: add `dailyDigestEmail` and `type DigestRow` to the `@/features/scheduling/templates` import, and add `import { env } from "@/env";` (the file does not import it today; `notify.test.ts` mocks `@/env` as `{ env: {} }`, so read `env.NEXT_PUBLIC_APP_URL ?? ""`).

`MemberNotice` — add the variant:

```ts
  | {
      event: "dailyDigest";
      requests: DigestRow[];
      holds: DigestRow[];
      balances: DigestRow[];
    };
```

`pushUrlFor`:

```ts
export function pushUrlFor(event: MemberEvent): string {
  return event === "newRequest" || event === "dailyDigest" ? "/overview" : "/bookings";
}
```

`emailFor()` — first branch:

```ts
      if (input.event === "dailyDigest") {
        email = dailyDigestEmail(mail.t, {
          requests: input.requests,
          holds: input.holds,
          balances: input.balances,
          overviewUrl: `${env.NEXT_PUBLIC_APP_URL ?? ""}/overview`,
        });
      } else if (input.event === "cancelled") {
```

`pushPayload` body:

```ts
    const pushPayload: PushPayload = {
      title: mail.t(`push.${input.event}.title`),
      body:
        input.event === "dailyDigest"
          ? mail.t("push.dailyDigest.body", { count: input.requests.length + input.holds.length + input.balances.length })
          : mail.t(`push.${input.event}.body`, { client: input.clientName, service: input.serviceName, when: input.whenLine }),
      url: pushUrlFor(input.event),
      tag: input.idempotencyKey,
    };
```

`replyTo` line:

```ts
              // Replies go to the client, not the platform's no-reply sender.
              // The digest has no single client to answer.
              replyTo: "clientEmail" in input ? (input.clientEmail ?? undefined) : undefined,
```

- [ ] **Step 5: Messages (three locales)**

`messages/en.json`:
- `emails.digest` (new object, next to `providerNew`):
  ```json
  "digest": {
    "subject": "{count, plural, one {# thing needs} other {# things need}} you today",
    "lead": "Your morning list.",
    "requests": "Requests waiting ({count})",
    "holds": "Holds expiring soon ({count})",
    "balances": "Balances due ({count})",
    "deposit": "{amount} deposit, until {time}",
    "lapsed": "{amount} deposit, payment window passed",
    "due": "{amount} due",
    "fallbackTitle": "Booking",
    "open": "Open your list",
    "openText": "Open your list: {url}",
    "footer": "You get this once a day while something is waiting. Turn it off under Notifications."
  }
  ```
- `emails.push.dailyDigest`: `{ "title": "Your morning list", "body": "{count, plural, one {# thing needs} other {# things need}} you today" }`
- `notifications.events.dailyDigest`: `"Morning list — once a day while something is waiting"`

`messages/uk.json`:
- `emails.digest`:
  ```json
  "digest": {
    "subject": "{count, plural, one {# справа чекає} few {# справи чекають} many {# справ чекають} other {# справи чекають}} на вас сьогодні",
    "lead": "Ваш ранковий список.",
    "requests": "Запити чекають ({count})",
    "holds": "Утримані бронювання скоро спливуть ({count})",
    "balances": "Залишки до сплати ({count})",
    "deposit": "передоплата {amount}, до {time}",
    "lapsed": "передоплата {amount}, час на оплату минув",
    "due": "{amount} до сплати",
    "fallbackTitle": "Бронювання",
    "open": "Відкрити список",
    "openText": "Відкрити список: {url}",
    "footer": "Цей лист надходить раз на день, поки щось чекає на вас. Вимкнути можна в розділі «Сповіщення»."
  }
  ```
- `emails.push.dailyDigest`: `{ "title": "Ваш ранковий список", "body": "{count, plural, one {# справа чекає} few {# справи чекають} many {# справ чекають} other {# справи чекають}} на вас сьогодні" }`
- `notifications.events.dailyDigest`: `"Ранковий список — раз на день, поки щось чекає"`

`messages/pl.json`:
- `emails.digest`:
  ```json
  "digest": {
    "subject": "{count, plural, one {# sprawa czeka} few {# sprawy czekają} many {# spraw czeka} other {# sprawy czeka}} dziś na Ciebie",
    "lead": "Twoja poranna lista.",
    "requests": "Prośby czekają ({count})",
    "holds": "Rezerwacje wstrzymane wkrótce wygasną ({count})",
    "balances": "Salda do zapłaty ({count})",
    "deposit": "zaliczka {amount}, do {time}",
    "lapsed": "zaliczka {amount}, czas na płatność minął",
    "due": "{amount} do zapłaty",
    "fallbackTitle": "Rezerwacja",
    "open": "Otwórz listę",
    "openText": "Otwórz listę: {url}",
    "footer": "Ten e-mail przychodzi raz dziennie, dopóki coś czeka. Wyłączysz go w sekcji „Powiadomienia”."
  }
  ```
- `emails.push.dailyDigest`: `{ "title": "Twoja poranna lista", "body": "{count, plural, one {# sprawa czeka} few {# sprawy czekają} many {# spraw czeka} other {# sprawy czeka}} dziś na Ciebie" }`
- `notifications.events.dailyDigest`: `"Poranna lista — raz dziennie, dopóki coś czeka"`

(`digest.deposit` / `lapsed` / `due` / `fallbackTitle` are consumed by Task 5's row builder; they live here so the three locales land in one commit.)

- [ ] **Step 6: Run the unit suites**

Run: `npm test -- src/features/notifications src/i18n`
Expected: PASS — notify (incl. the three new cases), prefs (parity now agrees: 5 = 5), messages parity.

- [ ] **Step 7: Commit**

```bash
git add src/features/notifications/prefs.ts src/features/notifications/prefs.test.ts src/features/notifications/notify.ts src/features/notifications/notify.test.ts src/features/scheduling/templates.ts messages/en.json messages/uk.json messages/pl.json
git commit -m "feat(notifications): dailyDigest member event — prefs row, digest mail, push to /overview (S4)"
```

---

### Task 3: The loader — `loadDailyList`

**Files:**
- Create: `src/features/scheduling/daily-list.ts`, `src/features/scheduling/daily-list.integration.test.ts`
- Modify: `src/features/scheduling/queries.ts:395-409` (delete `listPendingRequests`), `src/app/(dashboard)/overview/page.tsx:12,60` (temporary: keep the page compiling — Task 4 rewires it properly)

**Interfaces:**
- Consumes: `BOOKING_COLUMNS`, `toAdminBooking`, `BookingRow`, `AdminBooking` from `./queries`; `list_balances_due` (Task 1).
- Produces:
  ```ts
  export const HOLDS_WINDOW_MS = 24 * 60 * 60 * 1000;
  export const BALANCES_WINDOW_DAYS = 30;
  export const LIST_CAP = 50;
  export type BalanceDue = AdminBooking & { balanceCents: number };
  export type DailyList = { requests: AdminBooking[]; holds: AdminBooking[]; balances: BalanceDue[] };
  export async function loadDailyList(db: SupabaseClient, orgId: string, fallbackTitle: string, now?: Date): Promise<DailyList>;
  ```

- [ ] **Step 1: Write the failing integration test**

`src/features/scheduling/daily-list.integration.test.ts`:

```ts
/**
 * S4 loader against the local stack: the three sections, their windows and
 * the org gate, once through the admin client and once as a member.
 * Requires `supabase start`.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

try {
  loadEnvFile(".env.local");
} catch {
  /* CI exports env */
}
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";

const { loadDailyList } = await import("./daily-list");
const { generateAccessToken } = await import("@/lib/tokens/mint");
const { wallTimeToUtc } = await import("@/features/scheduling/slots");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const TZ = "Europe/Warsaw";
const DAY = "2027-08-02"; // far future: the create RPC only takes future starts
const H = 60 * 60 * 1000;
const D = 24 * H;
let counter = 0;

async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `dl_${tag}_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
  const password = "Password123!";
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw e;
  return client;
}

async function newOrg(tag: string) {
  const client = await signedInUser(tag);
  const { data: org, error: e1 } = await client.rpc("create_org", {
    p_name: `S4 ${tag}`,
    p_offers_appointments: false,
    p_offers_rentals: true,
  });
  if (e1) throw e1;
  const orgId = (org as { id: string }).id;
  const handle = `s4dl-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { error: e2 } = await client.rpc("update_org_scheduling", {
    p_org_id: orgId,
    p_handle: handle,
    p_timezone: TZ,
    p_currency: "PLN",
  });
  if (e2) throw e2;
  const { data: off, error: e3 } = await client
    .from("rental_offerings")
    .insert({
      org_id: orgId,
      name: "Studio",
      range_mode: "hours",
      slot_increment_min: 30,
      min_duration_min: 60,
      max_duration_min: 240,
      turnover_min: 0,
      min_notice_min: 0,
      booking_window_days: 730,
      unit_selection: "auto",
      active: true,
      price_cents: 10000,
      pricing_mode: "per_unit",
      deposit_type: "percent",
      deposit_value: 50,
    })
    .select("id")
    .single();
  if (e3) throw e3;
  const { error: e4 } = await client
    .from("rental_units")
    .insert({ org_id: orgId, offering_id: off!.id, name: "Studio", active: true, sort_order: 0 });
  if (e4) throw e4;
  const rules = Array.from({ length: 7 }, (_, weekday) => ({
    org_id: orgId,
    rental_offering_id: off!.id,
    weekday,
    start_time: "00:00",
    end_time: "23:59",
  }));
  const { error: e5 } = await client.from("availability_rules").insert(rules);
  if (e5) throw e5;
  return { client, orgId, handle, offeringId: off!.id as string };
}

/** A confirmed booking at DAY hh:00 (no payment account → confirmed, pay at
    the venue). `hour` keeps rows apart under the unit's EXCLUDE. */
async function createHours(handle: string, offeringId: string, hour: number, name: string) {
  const token = generateAccessToken();
  const { data, error } = await admin.rpc("create_rental_booking_hours", {
    p_handle: handle,
    p_offering_id: offeringId,
    p_unit_id: null,
    p_starts_at: wallTimeToUtc(DAY, `${String(hour).padStart(2, "0")}:00`, TZ).toISOString(),
    p_duration_min: 60,
    p_name: name,
    p_email: `c${counter++}@example.com`,
    p_note: null,
    p_token_hash: token.tokenHash,
    p_people: null,
    p_extras: [],
  });
  if (error) throw error;
  return data as string;
}

/** Service-role edits that put a row into the state under test. The
    EXCLUDE constraint is per unit and the moved rows land on distinct days. */
async function patch(id: string, fields: Record<string, unknown>) {
  const { error } = await admin.from("bookings").update(fields).eq("id", id);
  if (error) throw error;
}

function at(offsetMs: number, now: Date) {
  return new Date(now.getTime() + offsetMs).toISOString();
}

describe("loadDailyList", () => {
  const now = new Date();
  let org: Awaited<ReturnType<typeof newOrg>>;
  let ids: Record<string, string>;

  beforeAll(async () => {
    org = await newOrg("main");
    const o = org;
    ids = {
      requestIn: await createHours(o.handle, o.offeringId, 8, "Request In"),
      requestPast: await createHours(o.handle, o.offeringId, 9, "Request Past"),
      holdSoon: await createHours(o.handle, o.offeringId, 10, "Hold Soon"),
      holdLapsed: await createHours(o.handle, o.offeringId, 11, "Hold Lapsed"),
      holdFar: await createHours(o.handle, o.offeringId, 12, "Hold Far"),
      endedUnpaid: await createHours(o.handle, o.offeringId, 13, "Ended Unpaid"),
      endedPaid: await createHours(o.handle, o.offeringId, 14, "Ended Paid"),
      endedWrittenOff: await createHours(o.handle, o.offeringId, 15, "Ended Written Off"),
      endedOld: await createHours(o.handle, o.offeringId, 16, "Ended Old"),
      futureUnpaid: await createHours(o.handle, o.offeringId, 17, "Future Unpaid"),
    };
    // Requests: pending, one in the future (in), one in the past (out).
    await patch(ids.requestIn, { status: "pending" });
    await patch(ids.requestPast, { status: "pending", starts_at: at(-3 * D, now), ends_at: at(-3 * D + H, now) });
    // Holds: +2 h (in), −5 min not yet swept (in, first), +30 h (out).
    await patch(ids.holdSoon, { status: "pending_payment", hold_expires_at: at(2 * H, now) });
    await patch(ids.holdLapsed, { status: "pending_payment", hold_expires_at: at(-5 * 60_000, now) });
    await patch(ids.holdFar, { status: "pending_payment", hold_expires_at: at(30 * H, now) });
    // Balances: ended yesterday unpaid (in: balance = price 10000); ended and
    // fully paid (out); ended and written off (out); ended 40 days ago (out);
    // still in the future and unpaid (out).
    await patch(ids.endedUnpaid, { starts_at: at(-1 * D, now), ends_at: at(-1 * D + H, now) });
    await patch(ids.endedPaid, { starts_at: at(-2 * D, now), ends_at: at(-2 * D + H, now), paid_cents: 10000 });
    await patch(ids.endedWrittenOff, { starts_at: at(-4 * D, now), ends_at: at(-4 * D + H, now), written_off_cents: 10000 });
    await patch(ids.endedOld, { starts_at: at(-40 * D, now), ends_at: at(-40 * D + H, now) });
    // A stranger org with an ended unpaid booking: never in this org's list.
    const other = await newOrg("other");
    const strangerId = await createHours(other.handle, other.offeringId, 13, "Stranger");
    await patch(strangerId, { starts_at: at(-1 * D, now), ends_at: at(-1 * D + H, now) });
    ids.stranger = strangerId;
  });

  it("admin client: exactly the right rows, in order, with the SQL balance", async () => {
    const list = await loadDailyList(admin, org.orgId, "Booking", new Date());
    expect(list.requests.map((b) => b.id)).toEqual([ids.requestIn]);
    expect(list.holds.map((b) => b.id)).toEqual([ids.holdLapsed, ids.holdSoon]);
    expect(list.balances.map((b) => b.id)).toEqual([ids.endedUnpaid]);
    expect(list.balances[0].balanceCents).toBe(10000);
    expect(list.balances[0].clientName).toBe("Ended Unpaid");
  });

  it("member client (RLS): the same list", async () => {
    const list = await loadDailyList(org.client, org.orgId, "Booking", new Date());
    expect(list.requests.map((b) => b.id)).toEqual([ids.requestIn]);
    expect(list.holds.map((b) => b.id)).toEqual([ids.holdLapsed, ids.holdSoon]);
    expect(list.balances.map((b) => b.id)).toEqual([ids.endedUnpaid]);
  });

  it("list_balances_due: a signed-in non-member gets no rows, not an error", async () => {
    const outsider = await signedInUser("outsider");
    const { data, error } = await outsider.rpc("list_balances_due", {
      p_org_id: org.orgId,
      p_since: new Date(Date.now() - 30 * D).toISOString(),
      p_limit: 50,
    });
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("list_balances_due: anon is refused", async () => {
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    const { error } = await anon.rpc("list_balances_due", {
      p_org_id: org.orgId,
      p_since: new Date(Date.now() - 30 * D).toISOString(),
      p_limit: 50,
    });
    expect(error).not.toBeNull();
  });
});
```

Run: `npm run test:integration -- src/features/scheduling/daily-list.integration.test.ts`
Expected: FAIL — `./daily-list` does not exist.

- [ ] **Step 2: Write the loader**

`src/features/scheduling/daily-list.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { BOOKING_COLUMNS, toAdminBooking, type AdminBooking, type BookingRow } from "./queries";

/* S4 daily action list (spec 2026-09-08). ONE loader for two callers: the
   Overview page (user client under RLS) and the morning-digest drain phase
   (admin client). The org filter is always explicit so the two paths cannot
   diverge (spec ruling 9). Read errors throw: the page has its error
   boundary, the drain its per-org try. */

export const HOLDS_WINDOW_MS = 24 * 60 * 60 * 1000;
export const BALANCES_WINDOW_DAYS = 30;
export const LIST_CAP = 50;

export type BalanceDue = AdminBooking & { balanceCents: number };
export type DailyList = { requests: AdminBooking[]; holds: AdminBooking[]; balances: BalanceDue[] };

export async function loadDailyList(
  db: SupabaseClient,
  orgId: string,
  fallbackTitle: string,
  now: Date = new Date(),
): Promise<DailyList> {
  const nowIso = now.toISOString();
  const [requests, holds, balances] = await Promise.all([
    db
      .from("bookings")
      .select(BOOKING_COLUMNS)
      .eq("org_id", orgId)
      .eq("status", "pending")
      .gt("starts_at", nowIso)
      .order("starts_at", { ascending: true })
      .limit(LIST_CAP),
    db
      .from("bookings")
      .select(BOOKING_COLUMNS)
      .eq("org_id", orgId)
      .eq("status", "pending_payment")
      .lte("hold_expires_at", new Date(now.getTime() + HOLDS_WINDOW_MS).toISOString())
      .order("hold_expires_at", { ascending: true })
      .limit(LIST_CAP),
    loadBalances(db, orgId, fallbackTitle, now),
  ]);
  if (requests.error) throw requests.error;
  if (holds.error) throw holds.error;
  const rows = (data: unknown) => ((data ?? []) as BookingRow[]).map((b) => toAdminBooking(b, fallbackTitle));
  return { requests: rows(requests.data), holds: rows(holds.data), balances };
}

/* The balance is SQL's (0082 booking_balance_cents via list_balances_due,
   spec ruling 10): ids + amounts come back, then one select maps them to
   AdminBooking through the caller's own client, keeping the RPC's order. */
async function loadBalances(db: SupabaseClient, orgId: string, fallbackTitle: string, now: Date): Promise<BalanceDue[]> {
  const since = new Date(now.getTime() - BALANCES_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: due, error } = await db.rpc("list_balances_due", { p_org_id: orgId, p_since: since, p_limit: LIST_CAP });
  if (error) throw error;
  const order = ((due ?? []) as Array<{ id: string; balance_cents: number }>);
  if (order.length === 0) return [];
  const { data, error: rowsError } = await db
    .from("bookings")
    .select(BOOKING_COLUMNS)
    .in(
      "id",
      order.map((r) => r.id),
    );
  if (rowsError) throw rowsError;
  const byId = new Map(((data ?? []) as unknown as BookingRow[]).map((b) => [b.id, toAdminBooking(b, fallbackTitle)]));
  return order.flatMap((r) => {
    const booking = byId.get(r.id);
    return booking ? [{ ...booking, balanceCents: r.balance_cents }] : [];
  });
}
```

Note: `.select(BOOKING_COLUMNS)` returns a typed-as-unknown shape; cast through `unknown` as `queries.ts` does (`(data ?? []) as unknown as BookingRow[]`) if TS complains in `rows()`.

- [ ] **Step 3: Delete `listPendingRequests`, keep the page compiling**

In `src/features/scheduling/queries.ts` delete the `listPendingRequests` function (lines ~395–409) and its doc comment. Keep `countPendingRequests`.

In `src/app/(dashboard)/overview/page.tsx` (temporary until Task 4): replace the import and the call —

```ts
import { listStatsBookings } from "@/features/scheduling/queries";
import { loadDailyList } from "@/features/scheduling/daily-list";
import { createClient } from "@/lib/supabase/server";
```

and inside the component, before the `Promise.all`:

```ts
  const orgId = settings?.orgId;
  const fallbackTitle = (await getTranslations("bookings"))("fallbackTitle");
```

then in the `Promise.all` replace `listPendingRequests(),` with

```ts
    orgId ? loadDailyList(await createClient(), orgId, fallbackTitle, now).then((l) => l.requests) : Promise.resolve([]),
```

(`getTranslations` is already imported from `next-intl/server`.)

Run: `npm run typecheck && npm test`
Expected: clean.

- [ ] **Step 4: Run the integration test**

Run: `npm run test:integration -- src/features/scheduling/daily-list.integration.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/scheduling/daily-list.ts src/features/scheduling/daily-list.integration.test.ts src/features/scheduling/queries.ts "src/app/(dashboard)/overview/page.tsx"
git commit -m "feat(scheduling): loadDailyList — requests, holds ≤24h, balances due via list_balances_due (S4)"
```

---

### Task 4: Overview UI — `DailyList` above the heatmap

**Files:**
- Modify: `src/features/scheduling/components/requests-inbox.tsx:112-210` (extract `ActionRow`), `src/app/(dashboard)/overview/page.tsx`, `messages/en.json`, `messages/uk.json`, `messages/pl.json`
- Create: `src/features/scheduling/components/daily-list.tsx`
- Test: `src/i18n/messages.test.ts` (parity), `npm run typecheck`, browser QA in Task 6

**Interfaces:**
- Consumes: `DailyList`, `BalanceDue` (Task 3); `markBookingPaid({ id })` from `@/features/scheduling/booking-actions`; `sendBalanceLink({ id })`, `writeOffBooking({ id, note? })` from `@/features/payments/actions`; `hasActivePaymentAccount(orgId)` from `@/features/payments/queries`; `formatUntil`, `whenLineFor` from `@/features/scheduling/templates`; `dateInZone` from `@/features/scheduling/slots`.
- Produces: `export function ActionRow({ title, detail, children })` (in `requests-inbox.tsx`); `export function DailyList({ list, timeZone, canCollectOnline })`.

- [ ] **Step 1: Messages (three locales) — `overview.*`**

`messages/en.json` → add to `overview`:

```json
    "holds": "Holds expiring soon",
    "balances": "Balances due",
    "deposit": "{amount} deposit",
    "open": "Open",
    "openFor": "Open the booking for {name}",
    "markPaid": "Mark paid",
    "markPaidFor": "Mark paid for {name}",
    "sendLinkFor": "Send a balance link to {name}",
    "writeOffFor": "Write off the balance for {name}",
    "writeOffTitle": "Write off the balance",
    "writeOffBody": "The balance drops to zero and the booking counts as settled. Nothing is sent to the client.",
    "writeOffNote": "Note (optional)",
    "writeOffNotePlaceholder": "Why — e.g. goodwill after a late start."
```

`messages/uk.json` → `overview`:

```json
    "holds": "Утримані бронювання скоро спливуть",
    "balances": "Залишки до сплати",
    "deposit": "передоплата {amount}",
    "open": "Відкрити",
    "openFor": "Відкрити бронювання — {name}",
    "markPaid": "Позначити оплаченим",
    "markPaidFor": "Позначити оплаченим — {name}",
    "sendLinkFor": "Надіслати посилання на оплату — {name}",
    "writeOffFor": "Списати залишок — {name}",
    "writeOffTitle": "Списати залишок",
    "writeOffBody": "Залишок стає нульовим, а бронювання вважається закритим. Клієнту нічого не надсилається.",
    "writeOffNote": "Примітка (необов’язково)",
    "writeOffNotePlaceholder": "Причина — наприклад, знижка за пізній початок."
```

`messages/pl.json` → `overview`:

```json
    "holds": "Rezerwacje wstrzymane wkrótce wygasną",
    "balances": "Salda do zapłaty",
    "deposit": "zaliczka {amount}",
    "open": "Otwórz",
    "openFor": "Otwórz rezerwację — {name}",
    "markPaid": "Oznacz jako zapłacone",
    "markPaidFor": "Oznacz jako zapłacone — {name}",
    "sendLinkFor": "Wyślij link do zapłaty — {name}",
    "writeOffFor": "Umórz saldo — {name}",
    "writeOffTitle": "Umórz saldo",
    "writeOffBody": "Saldo spada do zera, a rezerwacja liczy się jako rozliczona. Klient nic nie dostaje.",
    "writeOffNote": "Notatka (opcjonalnie)",
    "writeOffNotePlaceholder": "Powód — np. gest po spóźnionym starcie."
```

Run: `npm test -- src/i18n/messages.test.ts` → PASS.

- [ ] **Step 2: Extract `ActionRow` from `RequestRow`**

In `src/features/scheduling/components/requests-inbox.tsx`, add above `RequestRow`:

```tsx
/* The row shell every Overview list shares (spec 2026-09-08 S4): title line,
   one truncated detail line reachable on hover, actions inline on desktop
   and wrapped below on phones. */
export function ActionRow({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{title}</p>
        <p className="text-muted-foreground truncate text-xs" title={detail}>
          {detail}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </li>
  );
}
```

and make `RequestRow`'s return use it:

```tsx
  return (
    <>
      <ActionRow title={booking.clientName} detail={detail}>
        <Button
          size="sm"
          onClick={accept}
          disabled={pending}
          aria-label={t("requests.acceptFrom", { name: booking.clientName })}
        >
          {t("requests.accept")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDeclining(true)}
          disabled={pending}
          aria-label={t("requests.declineFrom", { name: booking.clientName })}
        >
          {t("requests.decline")}
        </Button>
      </ActionRow>
      <DeclineRequestDialog bookingId={booking.id} open={declining} onOpenChange={setDeclining} />
    </>
  );
```

(The dialog moves outside the `<li>`; it renders in a portal, so the DOM position is irrelevant. Delete the two comments that described the old inline layout only if they now describe `ActionRow` — keep the accessible-name comment.)

- [ ] **Step 3: `daily-list.tsx`**

`src/features/scheduling/components/daily-list.tsx`:

```tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogBreadcrumbHeader,
  DialogChip,
  DialogContent,
  DialogDescription,
  DialogFooterBar,
  dialogBareInputClass,
  dialogPanelClass,
} from "@/components/ui/dialog";
import { markBookingPaid } from "@/features/scheduling/booking-actions";
import { sendBalanceLink, writeOffBooking } from "@/features/payments/actions";
import type { AdminBooking } from "@/features/scheduling/queries";
import type { BalanceDue, DailyList as DailyListData } from "@/features/scheduling/daily-list";
import { formatUntil, whenLineFor } from "@/features/scheduling/templates";
import { dateInZone } from "@/features/scheduling/slots";
import { ActionRow, RequestsInbox } from "./requests-inbox";
import { INTL_LOCALES } from "@/i18n/config";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/* S4 (spec 2026-09-08): the Overview's first block. Three sections, each
   nothing when empty; the whole thing nothing when all are (ruling 4). */
export function DailyList({
  list,
  timeZone,
  canCollectOnline,
}: {
  list: DailyListData;
  timeZone: string;
  canCollectOnline: boolean;
}) {
  if (list.requests.length + list.holds.length + list.balances.length === 0) return null;
  return (
    <div className="flex flex-col gap-10">
      <RequestsInbox requests={list.requests} timeZone={timeZone} />
      <HoldsExpiring holds={list.holds} timeZone={timeZone} />
      <BalancesDue balances={list.balances} timeZone={timeZone} canCollectOnline={canCollectOnline} />
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        <span className="text-muted-foreground text-xs">{count}</span>
      </div>
      <ul className="bg-card divide-y rounded-xl border">{children}</ul>
    </section>
  );
}

function useWhen(timeZone: string) {
  const intlLocale = INTL_LOCALES[useLocale()];
  return {
    intlLocale,
    line: (b: AdminBooking) =>
      whenLineFor(
        { startsAt: new Date(b.startsAt), endsAt: new Date(b.endsAt), isRental: b.rentalUnitId !== null, rangeMode: b.rangeMode },
        timeZone,
        intlLocale,
      ),
  };
}

/* "Open" lands on the bookings page in Day view on the booking's date; the
   detail dialog has no URL of its own (spec choice 3). */
function OpenLink({ booking, timeZone }: { booking: AdminBooking; timeZone: string }) {
  const t = useTranslations("overview");
  return (
    <Link
      href={`/bookings?view=day&date=${dateInZone(new Date(booking.startsAt), timeZone)}`}
      className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
      aria-label={t("openFor", { name: booking.clientName })}
    >
      {t("open")}
    </Link>
  );
}

// ---------- holds ----------------------------------------------------------

function HoldsExpiring({ holds, timeZone }: { holds: AdminBooking[]; timeZone: string }) {
  const t = useTranslations("overview");
  return (
    <Section title={t("holds")} count={holds.length}>
      {holds.map((b) => (
        <HoldRow key={b.id} booking={b} timeZone={timeZone} />
      ))}
    </Section>
  );
}

function HoldRow({ booking, timeZone }: { booking: AdminBooking; timeZone: string }) {
  const t = useTranslations("overview");
  const tb = useTranslations("bookings");
  const router = useRouter();
  const { intlLocale, line } = useWhen(timeZone);
  const [pending, startTransition] = React.useTransition();

  const deadline = booking.holdExpiresAt ? new Date(booking.holdExpiresAt) : null;
  const lapsed = deadline !== null && deadline.getTime() <= Date.now();
  const detail = [
    line(booking),
    booking.serviceName,
    booking.depositCents !== null && booking.currency ? t("deposit", { amount: formatMoney(booking.depositCents, booking.currency) }) : null,
    deadline ? (lapsed ? tb("hold.lapsed") : tb("hold.until", { time: formatUntil(deadline, timeZone, intlLocale) })) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const markPaid = () =>
    startTransition(async () => {
      const result = await markBookingPaid({ id: booking.id });
      if (!result.ok) toast.error(result.error);
      else toast.success(tb("markPaid.done"));
      router.refresh();
    });

  return (
    <ActionRow title={booking.clientName} detail={detail}>
      <Button size="sm" onClick={markPaid} disabled={pending} aria-label={t("markPaidFor", { name: booking.clientName })}>
        {t("markPaid")}
      </Button>
      <OpenLink booking={booking} timeZone={timeZone} />
    </ActionRow>
  );
}

// ---------- balances -------------------------------------------------------

function BalancesDue({
  balances,
  timeZone,
  canCollectOnline,
}: {
  balances: BalanceDue[];
  timeZone: string;
  canCollectOnline: boolean;
}) {
  const t = useTranslations("overview");
  return (
    <Section title={t("balances")} count={balances.length}>
      {balances.map((b) => (
        <BalanceRow key={b.id} booking={b} timeZone={timeZone} canCollectOnline={canCollectOnline} />
      ))}
    </Section>
  );
}

function BalanceRow({
  booking,
  timeZone,
  canCollectOnline,
}: {
  booking: BalanceDue;
  timeZone: string;
  canCollectOnline: boolean;
}) {
  const t = useTranslations("overview");
  const tc = useTranslations("bookings.charges");
  const router = useRouter();
  const { line } = useWhen(timeZone);
  const [pending, startTransition] = React.useTransition();
  const [confirmPaid, setConfirmPaid] = React.useState(false);
  const [writingOff, setWritingOff] = React.useState(false);
  const currency = booking.currency ?? "PLN";
  const detail = [line(booking), booking.serviceName, tc("balanceDue", { amount: formatMoney(booking.balanceCents, currency) })].join(" · ");

  const markPaid = () =>
    startTransition(async () => {
      const result = await markBookingPaid({ id: booking.id });
      if (!result.ok) toast.error(result.error);
      else toast.success(tc("paid"));
      setConfirmPaid(false);
      router.refresh();
    });
  const sendLink = () =>
    startTransition(async () => {
      const result = await sendBalanceLink({ id: booking.id });
      if (!result.ok) toast.error(result.error);
      else toast.success(tc("linkSent"));
    });

  return (
    <>
      <ActionRow title={booking.clientName} detail={detail}>
        {/* Two clicks, as the charges block does: the first arms, the second
            records the whole balance as cash (S7 decision 4). */}
        {confirmPaid ? (
          <Button variant="brand" size="sm" onClick={markPaid} disabled={pending} aria-label={t("markPaidFor", { name: booking.clientName })}>
            {tc("markPaidConfirm")}
          </Button>
        ) : (
          <Button size="sm" onClick={() => setConfirmPaid(true)} disabled={pending} aria-label={t("markPaidFor", { name: booking.clientName })}>
            {t("markPaid")}
          </Button>
        )}
        {canCollectOnline && booking.clientEmail ? (
          <Button variant="outline" size="sm" onClick={sendLink} disabled={pending} aria-label={t("sendLinkFor", { name: booking.clientName })}>
            {tc("sendLink")}
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={() => setWritingOff(true)} disabled={pending} aria-label={t("writeOffFor", { name: booking.clientName })}>
          {tc("writeOff")}
        </Button>
        <OpenLink booking={booking} timeZone={timeZone} />
      </ActionRow>
      <WriteOffDialog bookingId={booking.id} open={writingOff} onOpenChange={setWritingOff} />
    </>
  );
}

/* Write-off with an optional note — the DeclineRequestDialog skeleton. */
function WriteOffDialog({
  bookingId,
  open,
  onOpenChange,
}: {
  bookingId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("overview");
  const tc = useTranslations("bookings.charges");
  const tb = useTranslations("bookings");
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [note, setNote] = React.useState("");
  const noteId = React.useId();

  const change = (next: boolean) => {
    if (!next) setNote("");
    onOpenChange(next);
  };

  const writeOff = () =>
    startTransition(async () => {
      const result = await writeOffBooking({ id: bookingId, note: note.trim() || undefined });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(tc("writtenOffDone"));
      change(false);
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className={dialogPanelClass}>
        <DialogBreadcrumbHeader chip={<DialogChip tone="time">{t("balances")}</DialogChip>}>
          {t("writeOffTitle")}
        </DialogBreadcrumbHeader>
        <div className="flex flex-col px-5 pt-4 pb-6">
          <DialogDescription>{t("writeOffBody")}</DialogDescription>
          <textarea
            id={noteId}
            aria-label={t("writeOffNote")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder={t("writeOffNotePlaceholder")}
            className={cn(dialogBareInputClass, "mt-4 resize-none text-sm")}
          />
        </div>
        <DialogFooterBar>
          <Button variant="ghost" size="sm" onClick={() => change(false)} disabled={pending}>
            {tb("keep")}
          </Button>
          <Button variant="destructive" size="sm" onClick={writeOff} disabled={pending}>
            {tc("writeOffConfirm")}
          </Button>
        </DialogFooterBar>
      </DialogContent>
    </Dialog>
  );
}
```

Verified shapes (2026-09-08): `Button` accepts `variant="brand"` (`booking-charges.tsx` uses it) and `buttonVariants` is exported from `@/components/ui/button` (the Overview page uses it). `markBookingPaid`, `sendBalanceLink` and `writeOffBooking` all return `{ ok: true } | { ok: false; error: string }` (`booking-actions.ts:246`, `payments/actions.ts:26`). `slots.ts` is pure (no server-only import) and is already imported by client components.

- [ ] **Step 4: Overview page**

Rewrite the data part of `src/app/(dashboard)/overview/page.tsx`:

```ts
import { listStatsBookings } from "@/features/scheduling/queries";
import { loadDailyList } from "@/features/scheduling/daily-list";
import { DailyList } from "@/features/scheduling/components/daily-list";
import { hasActivePaymentAccount } from "@/features/payments/queries";
import { createClient } from "@/lib/supabase/server";
```

(remove the `RequestsInbox` import — `DailyList` owns it now; remove the Task 3 temporary line), and in the component:

```ts
  const orgId = settings?.orgId ?? null;
  const fallbackTitle = (await getTranslations("bookings"))("fallbackTitle");
  const [list, canCollectOnline, rows, staff] = await Promise.all([
    orgId
      ? loadDailyList(await createClient(), orgId, fallbackTitle, now)
      : Promise.resolve({ requests: [], holds: [], balances: [] }),
    orgId ? hasActivePaymentAccount(orgId) : Promise.resolve(false),
    listStatsBookings(
      wallTimeToUtc(`${year}-01-01`, "00:00", timeZone).toISOString(),
      wallTimeToUtc(`${year + 1}-01-01`, "00:00", timeZone).toISOString(),
    ),
    listActiveStaff(),
  ]);
```

JSX: inside `<div className="flex min-w-0 flex-1 flex-col gap-10">`, put `<DailyList list={list} timeZone={timeZone} canCollectOnline={canCollectOnline} />` as the FIRST child, and delete the `<RequestsInbox …/>` mount and its "User ruling 2026-09-01" comment at the bottom. Replace that comment with, above `DailyList`:

```tsx
        {/* S4 (spec 2026-09-08 ruling 4): the action list leads the page —
            requests, holds expiring, balances due. Nothing at all when every
            section is empty, so the year glance is first on a quiet day. */}
```

- [ ] **Step 5: Verify**

Run: `npm run verify`
Expected: lint, typecheck, unit all green. Then `npm run dev`, sign in to the local demo org, open `/overview`: the list shows above the heatmap when the local DB has requests/holds/balances (the S7 QA left balances on the demo org; otherwise seed one via the integration test's approach with `npm run scheduling:drain` untouched).

- [ ] **Step 6: Commit**

```bash
git add src/features/scheduling/components/requests-inbox.tsx src/features/scheduling/components/daily-list.tsx "src/app/(dashboard)/overview/page.tsx" messages/en.json messages/uk.json messages/pl.json
git commit -m "feat(overview): daily action list — holds expiring + balances due with inline actions, above the heatmap (S4)"
```

---

### Task 5: Digest drain phase — `runDailyDigest`

**Files:**
- Create: `src/features/notifications/digest.ts`, `src/features/notifications/digest.integration.test.ts`
- Modify: `src/app/api/scheduling/drain/route.ts:14, 108-120`

**Interfaces:**
- Consumes: `digest_due_orgs()` (Task 1), `loadDailyList` (Task 3), `notifyMembers` + `dailyDigest` notice (Task 2), `emailTranslators`, `whenLineFor`, `formatUntil`, `formatMoney`.
- Produces:
  ```ts
  export const DIGEST_LOCAL_HOUR = 8;
  export const DIGEST_BATCH = 25;
  export async function runDailyDigest(deps: { db: SupabaseClient; transport?: EmailTransport; push?: (userId: string, payload: PushPayload) => Promise<unknown>; now?: Date }): Promise<{ sent: number; skipped: number; failed: number }>;
  ```

- [ ] **Step 1: Write the failing integration test**

`src/features/notifications/digest.integration.test.ts`:

```ts
/**
 * S4 morning digest against the local stack: digest_due_orgs picks orgs by
 * local hour + stamp, runDailyDigest claims each org once, skips (but
 * stamps) an empty list, and honours the member's matrix row.
 * Requires `supabase start`.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { EmailTransport, OutboundEmail } from "@/lib/email/transport";
import type { PushPayload } from "@/features/notifications/push";

try {
  loadEnvFile(".env.local");
} catch {
  /* CI exports env */
}
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";

const { runDailyDigest } = await import("./digest");
const { generateAccessToken } = await import("@/lib/tokens/mint");
const { wallTimeToUtc } = await import("@/features/scheduling/slots");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const DAY = "2027-08-09";
let counter = 0;

/** A zone where it is past 08:00 right now, and one where it is not. Both
    exist at every UTC hour: the +14/−12 spread covers 26 hours. */
function zones(now = new Date()) {
  const utcHour = now.getUTCHours();
  // local hour = utcHour + offset (mod 24); pick offsets deterministically.
  const past8 = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, -1, -2, -3, -4, -5, -6, -7, -8, -9, -10, -11].find(
    (o) => ((utcHour + o + 24) % 24) >= 8 && ((utcHour + o + 24) % 24) <= 22,
  )!;
  const before8 = [-11, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].find(
    (o) => ((utcHour + o + 24) % 24) < 8,
  )!;
  const name = (o: number) => (o === 0 ? "Etc/UTC" : `Etc/GMT${o > 0 ? "-" : "+"}${Math.abs(o)}`); // Etc/GMT signs are inverted
  return { past8: name(past8), before8: name(before8) };
}

async function signedInUser(tag: string) {
  const email = `dg_${tag}_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
  const password = "Password123!";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw e;
  return { client, email, userId: data.user!.id };
}

async function newOrg(tag: string, timezone: string) {
  const user = await signedInUser(tag);
  const { data: org, error: e1 } = await user.client.rpc("create_org", {
    p_name: `S4 ${tag}`,
    p_offers_appointments: false,
    p_offers_rentals: true,
  });
  if (e1) throw e1;
  const orgId = (org as { id: string }).id;
  const handle = `s4dg-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { error: e2 } = await user.client.rpc("update_org_scheduling", {
    p_org_id: orgId,
    p_handle: handle,
    p_timezone: timezone,
    p_currency: "PLN",
  });
  if (e2) throw e2;
  const { data: off, error: e3 } = await user.client
    .from("rental_offerings")
    .insert({
      org_id: orgId,
      name: "Studio",
      range_mode: "hours",
      slot_increment_min: 30,
      min_duration_min: 60,
      max_duration_min: 240,
      turnover_min: 0,
      min_notice_min: 0,
      booking_window_days: 730,
      unit_selection: "auto",
      active: true,
      price_cents: 10000,
      pricing_mode: "per_unit",
      deposit_type: "percent",
      deposit_value: 50,
    })
    .select("id")
    .single();
  if (e3) throw e3;
  const { error: e4 } = await user.client
    .from("rental_units")
    .insert({ org_id: orgId, offering_id: off!.id, name: "Studio", active: true, sort_order: 0 });
  if (e4) throw e4;
  const rules = Array.from({ length: 7 }, (_, weekday) => ({
    org_id: orgId,
    rental_offering_id: off!.id,
    weekday,
    start_time: "00:00",
    end_time: "23:59",
  }));
  const { error: e5 } = await user.client.from("availability_rules").insert(rules);
  if (e5) throw e5;
  return { ...user, orgId, handle, offeringId: off!.id as string, timezone };
}

async function createHours(handle: string, offeringId: string, hour: number, name: string) {
  const token = generateAccessToken();
  const { data, error } = await admin.rpc("create_rental_booking_hours", {
    p_handle: handle,
    p_offering_id: offeringId,
    p_unit_id: null,
    p_starts_at: wallTimeToUtc(DAY, `${String(hour).padStart(2, "0")}:00`, "Etc/UTC").toISOString(),
    p_duration_min: 60,
    p_name: name,
    p_email: `c${counter++}@example.com`,
    p_note: null,
    p_token_hash: token.tokenHash,
    p_people: null,
    p_extras: [],
  });
  if (error) throw error;
  return data as string;
}

function recorder() {
  const sent: OutboundEmail[] = [];
  const pushes: Array<{ userId: string; payload: PushPayload }> = [];
  const transport: EmailTransport = {
    async send(msg) {
      sent.push(msg);
      return { id: `t-${sent.length}` };
    },
  };
  const push = async (userId: string, payload: PushPayload) => {
    pushes.push({ userId, payload });
    return { sent: 1, dropped: 0, failed: 0 };
  };
  return { sent, pushes, transport, push };
}

async function stamp(orgId: string) {
  const { data, error } = await admin.from("orgs").select("digest_sent_on").eq("id", orgId).single();
  if (error) throw error;
  return data.digest_sent_on as string | null;
}

/** The local DB holds every org other integration files ever created, all
    unstamped and therefore due. Stamp them out of the way (the RPC returns
    25 at a time — loop until it is empty) so these tests see only their own. */
async function drainDueOrgs() {
  for (let guard = 0; guard < 200; guard++) {
    const { data, error } = await admin.rpc("digest_due_orgs");
    if (error) throw error;
    const rows = (data ?? []) as Array<{ id: string; local_date: string }>;
    if (rows.length === 0) return;
    for (const r of rows) {
      const { error: e } = await admin.from("orgs").update({ digest_sent_on: r.local_date }).eq("id", r.id);
      if (e) throw e;
    }
  }
  throw new Error("digest_due_orgs never drained");
}

beforeAll(drainDueOrgs);

describe("digest_due_orgs", () => {
  it("picks by local hour and stamp", async () => {
    const z = zones();
    const due = await newOrg("due", z.past8);
    const early = await newOrg("early", z.before8);
    const done = await newOrg("done", z.past8);
    const { data: local } = await admin.rpc("digest_due_orgs");
    const todayThere = (local as Array<{ id: string; local_date: string }>).find((r) => r.id === due.orgId)!.local_date;
    await admin.from("orgs").update({ digest_sent_on: todayThere }).eq("id", done.orgId);
    const yesterday = await newOrg("yesterday", z.past8);
    const y = new Date(new Date(todayThere).getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await admin.from("orgs").update({ digest_sent_on: y }).eq("id", yesterday.orgId);

    const { data, error } = await admin.rpc("digest_due_orgs");
    expect(error).toBeNull();
    const ids = (data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(due.orgId);
    expect(ids).toContain(yesterday.orgId);
    expect(ids).not.toContain(early.orgId);
    expect(ids).not.toContain(done.orgId);
  });

  it("is service-role only", async () => {
    const user = await signedInUser("nope");
    const { error } = await user.client.rpc("digest_due_orgs");
    expect(error).not.toBeNull();
  });
});

describe("runDailyDigest", () => {
  let org: Awaited<ReturnType<typeof newOrg>>;

  beforeAll(async () => {
    // The digest_due_orgs tests above left "due" and "yesterday" unstamped.
    await drainDueOrgs();
    org = await newOrg("run", zones().past8);
    const request = await createHours(org.handle, org.offeringId, 8, "Anna");
    await admin.from("bookings").update({ status: "pending" }).eq("id", request);
    const hold = await createHours(org.handle, org.offeringId, 10, "Ola");
    await admin
      .from("bookings")
      .update({ status: "pending_payment", hold_expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() })
      .eq("id", hold);
  });

  it("sends once per org per local day, then the claim holds", async () => {
    const r = recorder();
    const first = await runDailyDigest({ db: admin, transport: r.transport, push: r.push });
    expect(first.sent).toBe(1);
    expect(first.failed).toBe(0);
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0].to).toBe(org.email);
    expect(r.sent[0].subject).toBe("2 things need you today");
    expect(r.sent[0].text).toContain("Anna");
    expect(r.sent[0].text).toContain("Ola");
    expect(r.sent[0].idempotencyKey).toMatch(new RegExp(`^digest:${org.orgId}:\\d{4}-\\d{2}-\\d{2}$`));
    expect(r.pushes).toEqual([
      { userId: org.userId, payload: { title: "Your morning list", body: "2 things need you today", url: "/overview", tag: r.sent[0].idempotencyKey } },
    ]);
    expect(await stamp(org.orgId)).not.toBeNull();

    const again = await runDailyDigest({ db: admin, transport: r.transport, push: r.push });
    expect(again.sent).toBe(0);
    expect(r.sent).toHaveLength(1);
  });

  it("an empty list is stamped and counted as skipped", async () => {
    const quiet = await newOrg("quiet", zones().past8);
    const r = recorder();
    const out = await runDailyDigest({ db: admin, transport: r.transport, push: r.push });
    expect(out.skipped).toBe(1);
    expect(out.sent).toBe(0);
    expect(r.sent).toEqual([]);
    expect(await stamp(quiet.orgId)).not.toBeNull();
  });

  it("a member with email off gets push only", async () => {
    const o = await newOrg("pushonly", zones().past8);
    await o.client.rpc("update_member_notification_prefs", {
      p_org_id: o.orgId,
      p_prefs: {
        newBooking: { email: true, push: true },
        newRequest: { email: true, push: true },
        cancelled: { email: true, push: true },
        rescheduled: { email: true, push: true },
        dailyDigest: { email: false, push: true },
      },
    });
    const request = await createHours(o.handle, o.offeringId, 12, "Kasia");
    await admin.from("bookings").update({ status: "pending" }).eq("id", request);
    const r = recorder();
    const out = await runDailyDigest({ db: admin, transport: r.transport, push: r.push });
    expect(out.sent).toBe(1);
    expect(r.sent).toEqual([]);
    expect(r.pushes.map((p) => p.userId)).toEqual([o.userId]);
  });
});
```

Run: `npm run test:integration -- src/features/notifications/digest.integration.test.ts`
Expected: FAIL — `./digest` does not exist (the `digest_due_orgs` describe may already pass).

- [ ] **Step 2: Write `digest.ts`**

`src/features/notifications/digest.ts`:

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailTransport } from "@/lib/email/transport";
import { emailTranslators } from "@/i18n/emails";
import { formatMoney } from "@/lib/money";
import { loadDailyList } from "@/features/scheduling/daily-list";
import { formatUntil, whenLineFor, type DigestRow } from "@/features/scheduling/templates";
import type { AdminBooking } from "@/features/scheduling/queries";
import { notifyMembers } from "./notify";
import type { PushPayload } from "./push";

/* S4 morning digest (spec 2026-09-08 §Digest). Drain phase: the orgs past
   08:00 local time and not yet stamped for their local date come back from
   digest_due_orgs() (the hour lives there too — keep the two in step); each
   is CLAIMED by stamping its local date (one tick wins, the reminders.ts
   idiom), the list is loaded with the admin client, an empty list is
   skipped, anything else goes to notifyMembers as one dailyDigest notice.
   A failed send is not retried today: the stamp stands, the summary and the
   Worker's healthcheck make it visible. */

export const DIGEST_LOCAL_HOUR = 8; // mirrors digest_due_orgs() in 0083
export const DIGEST_BATCH = 25; // mirrors the RPC's LIMIT

type DueOrg = { id: string; name: string; timezone: string; locale: string; local_date: string };

export async function runDailyDigest(deps: {
  db: SupabaseClient;
  transport?: EmailTransport;
  push?: (userId: string, payload: PushPayload) => Promise<unknown>;
  now?: Date;
}): Promise<{ sent: number; skipped: number; failed: number }> {
  const now = deps.now ?? new Date();
  const { data, error } = await deps.db.rpc("digest_due_orgs");
  if (error) throw error;
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const org of ((data ?? []) as DueOrg[]).slice(0, DIGEST_BATCH)) {
    try {
      // The claim: only the tick that moves the stamp forward proceeds.
      const { data: claimed, error: claimError } = await deps.db
        .from("orgs")
        .update({ digest_sent_on: org.local_date })
        .eq("id", org.id)
        .or(`digest_sent_on.is.null,digest_sent_on.lt.${org.local_date}`)
        .select("id");
      if (claimError) throw claimError;
      if (!claimed || claimed.length === 0) continue;

      const mail = await emailTranslators(org.locale);
      const list = await loadDailyList(deps.db, org.id, mail.t("digest.fallbackTitle"), now);
      if (list.requests.length + list.holds.length + list.balances.length === 0) {
        skipped++;
        continue;
      }
      const when = (b: AdminBooking) =>
        whenLineFor(
          { startsAt: new Date(b.startsAt), endsAt: new Date(b.endsAt), isRental: b.rentalUnitId !== null, rangeMode: b.rangeMode },
          org.timezone,
          mail.intlLocale,
        );
      const money = (cents: number, currency: string | null) => formatMoney(cents, currency ?? "PLN");
      const requests: DigestRow[] = list.requests.map((b) => ({ clientName: b.clientName, whenLine: when(b), note: b.serviceName }));
      const holds: DigestRow[] = list.holds.map((b) => {
        const deadline = b.holdExpiresAt ? new Date(b.holdExpiresAt) : null;
        const amount = money(b.depositCents ?? 0, b.currency);
        const note =
          deadline && deadline.getTime() > now.getTime()
            ? mail.t("digest.deposit", { amount, time: formatUntil(deadline, org.timezone, mail.intlLocale) })
            : mail.t("digest.lapsed", { amount });
        return { clientName: b.clientName, whenLine: when(b), note };
      });
      const balances: DigestRow[] = list.balances.map((b) => ({
        clientName: b.clientName,
        whenLine: when(b),
        note: mail.t("digest.due", { amount: money(b.balanceCents, b.currency) }),
      }));

      await notifyMembers(
        { event: "dailyDigest", orgId: org.id, idempotencyKey: `digest:${org.id}:${org.local_date}`, requests, holds, balances },
        { db: deps.db, transport: deps.transport, push: deps.push },
      );
      sent++;
    } catch (error) {
      console.error(`[digest] org ${org.id} failed:`, error);
      failed++;
    }
  }
  return { sent, skipped, failed };
}
```

Notes for the implementer: `notifyMembers` never throws, so `sent` counts orgs handed to it, not deliveries (deliveries are logged per member inside the seam). The PostgREST `.or("digest_sent_on.is.null,digest_sent_on.lt.YYYY-MM-DD")` filter is the guard that makes the update a claim.

- [ ] **Step 3: Route wiring**

`src/app/api/scheduling/drain/route.ts` — import `runDailyDigest` from `@/features/notifications/digest`, and after the holds block:

```ts
    // S4: the morning list, once per org per local day. Its own try — a
    // digest problem must not hide the other four summaries.
    let digest: Awaited<ReturnType<typeof runDailyDigest>> | { error: string };
    try {
      digest = await runDailyDigest({ db: admin, transport: selectTransport() });
    } catch (error) {
      console.error("[digest] drain tick failed:", error);
      digest = { error: "digest failed" };
    }
    return Response.json({ ...summary, calendar, inbound, holds, digest });
```

Update the file's top comment that lists the phases (if it enumerates "four" → "five").

- [ ] **Step 4: Run the tests**

Run: `npm run test:integration -- src/features/notifications/digest.integration.test.ts src/features/scheduling/daily-list.integration.test.ts`
Expected: PASS. Then `npm run verify` → green.

- [ ] **Step 5: Manual tick**

With the dev server up and `SCHEDULING_DRAIN_SECRET` set in `.env.local`: `npm run scheduling:drain`. Expected JSON includes `"digest": { "sent": n, "skipped": m, "failed": 0 }`; Mailpit (`http://localhost:54354`) shows one "things need you today" mail per due org with a non-empty list; the org's `digest_sent_on` is today's local date (`select name, digest_sent_on from orgs;` in Studio). Running it again sends nothing.

- [ ] **Step 6: Commit**

```bash
git add src/features/notifications/digest.ts src/features/notifications/digest.integration.test.ts src/app/api/scheduling/drain/route.ts
git commit -m "feat(notifications): morning digest drain phase — claim per org per local day, dailyDigest notice (S4)"
```

---

### Task 6: Verify, QA, graph, PR

**Files:**
- Modify: none new; QA script in the scratchpad; `graphify-out/` regenerated.

- [ ] **Step 1: Full suites**

Run: `npm run verify && npm run test:integration`
Expected: all green (unit ≥ the pre-S4 count + 5; integration ≥ pre-S4 + 2 files).

- [ ] **Step 2: Browser QA (scripted Playwright from the npx cache, per the S7 recipe; drive `localhost`, never `127.0.0.1`)**

On the local demo org (Spaces mode, hourly space, no payment account unless the fake provider is configured):

1. Seed via the integration-test approach or Studio: one pending request, one `pending_payment` booking with `hold_expires_at = now + 1h`, one confirmed booking ended yesterday with `paid_cents = 0`.
2. `/overview`: the three sections render above "Activity", counts match; screenshot.
3. Hold row → **Mark paid** → toast, row gone on refresh, booking `confirmed` with a `deposit` ledger row.
4. Balance row → **Mark paid** shows "Confirm cash payment" → click → toast "Marked…"; row gone; the booking detail (Day view) shows Settled.
5. Re-seed a balance → **Write off** → note "goodwill" → confirm → toast "Balance written off."; row gone; detail shows "Written off".
6. **Send link** is absent without an active payment account; with the fake provider + an `active` `payment_accounts` row and a client email, it shows and toasts "Balance link sent." (Mailpit gets the balance-due mail).
7. **Open** → `/bookings?view=day&date=<that date>` in Day view.
8. Empty list: clear the rows → `/overview` starts with "Activity" (no empty box).
9. Notifications page: the "Morning list" row is present with both switches on; flipping email off and back persists (reload).
10. Keyboard: Tab through a balance row — Mark paid, Write off, Open reachable, accessible names include the client name (inspect `aria-label`).

Record results (pass/fail per step) in the PR description.

- [ ] **Step 3: Graph**

Run: `graphify update .`

- [ ] **Step 4: PR**

```bash
git push -u origin feat/s4-daily-list
gh pr create --base main --title "feat(overview): daily action list + morning digest (S4)" --body-file <body>
```

Body: goal (one paragraph), the eight rulings from the spec in one list, migration note ("0083 additive; next free 0084"), test counts, the QA table, deferred list (badge fold-in, digest hour setting, today's sessions, fees on cancelled rows, `?booking=` deep link, hold-expired notice, refund-overpayment), and the trailer:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01HwfEz5zNxoUcCZgEVGz8a5
```
