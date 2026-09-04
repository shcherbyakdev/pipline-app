# Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/notifications` page where the owner controls what they hear about (email + Web Push per event) and what clients receive (reminder on/off + lead time, Pro-gated), with the delivery seams that honour it.

**Architecture:** Preferences are two nullable jsonb columns (`org_members.notification_prefs` for the person, `orgs.notification_prefs` for the org's clients) validated by zod in the app and by SECURITY DEFINER RPCs in SQL. Owner notices flow through one new seam `notifyMembers()` that replaces the seven provider-email send sites and adds Web Push (`web-push`, VAPID). The reminder drain reads the org's reminder policy per row.

**Tech Stack:** Next.js App Router, Supabase (RLS + definer RPCs, hand-written SQL migrations under `src/db/migrations`), zod, next-intl (`en` + `uk`), Base UI switch, `web-push`, Vitest (unit) + Vitest integration config against local Supabase.

**Spec:** `docs/superpowers/specs/2026-09-05-notifications-design.md`

## Global Constraints

- Next free migration number is **0075**; journal entry `idx: 75` in `src/db/migrations/meta/_journal.json`.
- Every new table gets explicit `revoke all` + `grant` lines (0066 idiom). `orgs` / `org_members` stay select-only for `authenticated`; writes go through definer RPCs with `set search_path = ''`.
- Every user-visible string lives in `messages/en.json` and `messages/uk.json` under a new `notifications` namespace; push texts under `notifications.push`.
- Provider/push text follows the ORG locale (`emailTranslators(orgLocale)` idiom, spec D4).
- Nothing in a booking path may throw because a notice failed: every channel in its own try, `console.error` prefixed `[notifications]`.
- Reserved handles: add `notifications` to `RESERVED_HANDLES` (`src/features/scheduling/handle.ts`) AND to `public.reserved_handles()` in the migration.
- No native `<select>`: use the app's dropdown idiom (`@/components/ui/dropdown-menu`) for the lead-time picker.
- Commit after each task; `npm run verify` (lint + typecheck + unit tests) must be green before the PR.

---

### Task 1: Preference model (pure)

**Files:**
- Create: `src/features/notifications/prefs.ts`
- Test: `src/features/notifications/prefs.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const MEMBER_EVENTS = ["newBooking", "newRequest", "cancelled", "rescheduled"] as const;
  export type MemberEvent = (typeof MEMBER_EVENTS)[number];
  export type MemberPrefs = Record<MemberEvent, { email: boolean; push: boolean }>;
  export const REMINDER_LEAD_HOURS = [1, 2, 3, 6, 12, 24, 48] as const;
  export type ReminderLeadHours = (typeof REMINDER_LEAD_HOURS)[number];
  export const DEFAULT_REMINDER_LEAD_HOURS: ReminderLeadHours = 24;
  export type OrgPrefs = { reminder: { enabled: boolean; leadHours: ReminderLeadHours } };
  export const memberPrefsSchema: z.ZodType<MemberPrefs>;   // strict object, all four events required
  export const orgPrefsSchema: z.ZodType<OrgPrefs>;
  export function parseMemberPrefs(raw: unknown): MemberPrefs;   // null/invalid → defaults (all true)
  export function parseOrgPrefs(raw: unknown): OrgPrefs;         // null/invalid → { reminder: { enabled: true, leadHours: 24 } }
  export type ReminderPolicy = { enabled: boolean; leadMs: number };
  export function reminderPolicy(prefs: OrgPrefs, customAllowed: boolean): ReminderPolicy; // customAllowed=false pins 24 h
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { parseMemberPrefs, parseOrgPrefs, reminderPolicy, DEFAULT_REMINDER_LEAD_HOURS } from "./prefs";

describe("member prefs", () => {
  it("null and garbage parse to everything on", () => {
    expect(parseMemberPrefs(null).newRequest).toEqual({ email: true, push: true });
    expect(parseMemberPrefs({ newBooking: "yes" }).cancelled.push).toBe(true);
  });
  it("a partial object keeps defaults for what it omits", () => {
    const p = parseMemberPrefs({ cancelled: { email: false, push: true } });
    expect(p.cancelled.email).toBe(false);
    expect(p.newBooking.email).toBe(true);
  });
});

describe("org prefs + reminder policy", () => {
  it("defaults to a 24h reminder", () => {
    expect(parseOrgPrefs(null)).toEqual({ reminder: { enabled: true, leadHours: DEFAULT_REMINDER_LEAD_HOURS } });
  });
  it("rejects a lead outside the fixed set", () => {
    expect(parseOrgPrefs({ reminder: { enabled: true, leadHours: 5 } }).reminder.leadHours).toBe(24);
  });
  it("pins the lead to 24h when custom reminders are not allowed", () => {
    const prefs = parseOrgPrefs({ reminder: { enabled: true, leadHours: 2 } });
    expect(reminderPolicy(prefs, true)).toEqual({ enabled: true, leadMs: 2 * 3_600_000 });
    expect(reminderPolicy(prefs, false)).toEqual({ enabled: true, leadMs: 24 * 3_600_000 });
  });
  it("disabled survives the pin", () => {
    const prefs = parseOrgPrefs({ reminder: { enabled: false, leadHours: 48 } });
    expect(reminderPolicy(prefs, false).enabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/features/notifications/prefs.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement** `prefs.ts` (partial member objects merge over defaults per event; org schema `z.object({ reminder: z.object({ enabled: z.boolean(), leadHours: z.union(literals) }) })`, `safeParse` → defaults on failure).
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit** `feat(notifications): preference model`

---

### Task 2: Migration 0075 — columns, push_subscriptions, RPCs, reserved handle

**Files:**
- Create: `src/db/migrations/0075_notifications.sql`
- Modify: `src/db/migrations/meta/_journal.json` (append idx 75, tag `0075_notifications`)
- Modify: `src/db/schema/orgs.ts` (add `notificationPrefs: jsonb("notification_prefs")` to `orgs` and `orgMembers`)
- Create: `src/db/schema/notifications.ts` (`pushSubscriptions` table) + export from `src/db/schema/index.ts`
- Modify: `src/features/scheduling/handle.ts` (`"notifications"` in `RESERVED_HANDLES`)
- Test: `src/features/notifications/notifications.integration.test.ts`

**Interfaces:**
- Produces RPCs `update_member_notification_prefs(p_org_id uuid, p_prefs jsonb)` and `update_org_notification_prefs(p_org_id uuid, p_prefs jsonb)`, table `public.push_subscriptions`.

- [ ] **Step 1: Write the migration**

```sql
-- 0075 (Notifications, spec 2026-09-05): what a member hears about and what
-- an org's clients receive, plus the devices a member enabled for push.
alter table public.orgs add column notification_prefs jsonb;
alter table public.org_members add column notification_prefs jsonb;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_id_idx on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;
create policy "push_subscriptions_select_own" on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
create policy "push_subscriptions_insert_own" on public.push_subscriptions
  for insert to authenticated
  with check (user_id = (select auth.uid()) and org_id in (select public.user_orgs()));
create policy "push_subscriptions_delete_own" on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on table public.push_subscriptions from public, anon, authenticated, service_role;
grant select, insert, delete on table public.push_subscriptions to authenticated;
grant select, insert, update, delete on table public.push_subscriptions to service_role;

create or replace function public.update_member_notification_prefs(p_org_id uuid, p_prefs jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_key text; v_val jsonb;
begin
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then raise exception 'not found'; end if;
  if p_prefs is not null then
    if jsonb_typeof(p_prefs) <> 'object' then raise exception 'not found'; end if;
    for v_key, v_val in select * from jsonb_each(p_prefs) loop
      if v_key not in ('newBooking','newRequest','cancelled','rescheduled') then raise exception 'not found'; end if;
      if jsonb_typeof(v_val) <> 'object'
         or jsonb_typeof(v_val->'email') <> 'boolean' or jsonb_typeof(v_val->'push') <> 'boolean' then
        raise exception 'not found';
      end if;
    end loop;
  end if;
  update public.org_members set notification_prefs = p_prefs
   where org_id = p_org_id and user_id = (select auth.uid());
end; $$;
revoke all on function public.update_member_notification_prefs(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.update_member_notification_prefs(uuid, jsonb) to authenticated;

create or replace function public.update_org_notification_prefs(p_org_id uuid, p_prefs jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then raise exception 'not found'; end if;
  if p_prefs is not null then
    if jsonb_typeof(p_prefs) <> 'object' or jsonb_typeof(p_prefs->'reminder') <> 'object'
       or jsonb_typeof(p_prefs->'reminder'->'enabled') <> 'boolean'
       or (p_prefs->'reminder'->>'leadHours')::int not in (1,2,3,6,12,24,48) then
      raise exception 'not found';
    end if;
  end if;
  update public.orgs set notification_prefs = p_prefs where id = p_org_id;
end; $$;
revoke all on function public.update_org_notification_prefs(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.update_org_notification_prefs(uuid, jsonb) to authenticated;

-- /notifications is a top-level route: mirror of RESERVED_HANDLES (0066 body + 'notifications').
create or replace function public.reserved_handles() returns text[] language sql immutable set search_path = '' as $$
  select array[ ...0066 list..., 'notifications' ]::text[]
$$;
```

- [ ] **Step 2: Journal + drizzle schema + reserved handle** (as listed in Files).
- [ ] **Step 3: Apply locally** `npm run db:migrate`; confirm `\d push_subscriptions` via `psql`.
- [ ] **Step 4: Integration test** (waitlist.integration.test.ts idiom): owner + stranger users, `create_org`; stranger cannot insert a subscription for owner's org; owner inserts and reads own row; stranger sees none; `update_member_notification_prefs` rejects `{ bogus: true }` and a foreign org; accepts a valid object and the row reads back; same for `update_org_notification_prefs` with `leadHours: 5` rejected.
- [ ] **Step 5: Run** `npm run test:integration -- src/features/notifications` — PASS. Commit `feat(notifications): migration 0075`.

---

### Task 3: Push transport, service worker, installable app

**Files:**
- Modify: `package.json` (`web-push` dependency + `@types/web-push` dev)
- Modify: `src/env.ts` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`), `.env.example` if present
- Create: `src/features/notifications/push.ts`
- Create: `public/sw.js`
- Create: `src/app/manifest.ts`, `src/app/apple-icon.tsx`, `src/app/manifest-icon/route.tsx`

**Interfaces:**
- Produces:
  ```ts
  export type PushPayload = { title: string; body: string; url: string; tag: string };
  export function pushConfigured(): boolean;
  export function vapidPublicKey(): string | null;
  export function sendPush(userId: string, payload: PushPayload, deps?: { db?: SupabaseClient; send?: typeof webpush.sendNotification }): Promise<{ sent: number; dropped: number }>;
  ```
- `sendPush` reads `push_subscriptions` for the user as service_role, sends each with `TTL: 86400`, deletes rows on status 404/410, logs others; never throws.

- [ ] **Step 1:** `npm i web-push && npm i -D @types/web-push`.
- [ ] **Step 2:** `push.ts` per interface; `sw.js`:

```js
self.addEventListener("push", (e) => {
  const d = e.data ? e.data.json() : {};
  e.waitUntil(self.registration.showNotification(d.title || "Booklo", { body: d.body, tag: d.tag, data: { url: d.url }, icon: "/manifest-icon?size=192" }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/bookings";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const hit = list.find((c) => "focus" in c);
    return hit ? hit.navigate(url).then((c) => c && c.focus()) : self.clients.openWindow(url);
  }));
});
```

- [ ] **Step 3:** `manifest.ts` (`name: "Booklo"`, `start_url: "/bookings"`, `display: "standalone"`, icons `/manifest-icon?size=192` and `?size=512`), `apple-icon.tsx` (180 px ImageResponse, brand `#6975e2` square, white "b"), `manifest-icon/route.tsx` (same drawing, size from the query, clamped 64–512).
- [ ] **Step 4:** `npm run typecheck`; commit `feat(notifications): web push transport and installable app`.

---

### Task 4: The `notifyMembers` seam, replacing seven send sites

**Files:**
- Create: `src/features/notifications/notify.ts`
- Test: `src/features/notifications/notify.test.ts`
- Modify: `src/features/scheduling/public-actions.ts:308-333`, `src/features/scheduling/manage-actions.ts:190-208,347-365`, `src/features/rentals/public-actions.ts:335-355`, `src/features/rentals/hourly-actions.ts:344-364`, `src/features/rentals/manage-actions.ts:295-312,542-559`

**Interfaces:**
- Produces:
  ```ts
  export type MemberNotice =
    | { event: "newBooking" | "newRequest"; serviceName: string; clientName: string; clientEmail: string; whenLine: string; staffName?: string | null; note?: string | null; infoLines?: string[] }
    | { event: "cancelled"; serviceName: string; clientName: string; whenLine: string }
    | { event: "rescheduled"; serviceName: string; clientName: string; whenLine: string; oldWhenLine: string };
  export async function notifyMembers(input: MemberNotice & { orgId: string; idempotencyKey: string; url?: string }, deps?: NotifyDeps): Promise<void>;
  ```
- Consumes `parseMemberPrefs` (Task 1), `sendPush` (Task 3), `emailTranslators`, the three provider templates, `selectTransport`.
- `NotifyDeps` (for tests): `{ db, transport, push, now }`; production defaults to admin client, `selectTransport()`, `sendPush`.
- Push text: `notifications.push.<event>.title` + `.body` with `{client, service, when}`; `url` defaults to `/overview` for `newRequest`, `/bookings` otherwise; `tag` = idempotencyKey.

- [ ] **Step 1: Failing tests** — fake db (`from("org_members")` → rows with `user_id` + `notification_prefs`; `auth.admin.getUserById` → email; `from("orgs")` → `{ name, locale }`), fake transport recording sends, fake push recording calls:
  - email off + push on → one push, no email;
  - both on → both; push throws → email still sent and the promise resolves;
  - `newRequest` uses `providerNew.subjectRequest`.
- [ ] **Step 2:** implement; **Step 3:** replace each site: delete the `providerNewBookingEmail`/`providerCancelledEmail`/`providerRescheduledEmail` + `selectTransport().send({ to: providerEmail … })` block with `await notifyMembers({ orgId, event, …, idempotencyKey })`. Keep `getProviderEmail` where the client mail's `replyTo` or `isStaffTheProvider` needs it. Grep afterwards: `providerEmail` must no longer appear next to `selectTransport`.
- [ ] **Step 4:** `npm run verify`; existing tests that asserted the provider email (`templates.test.ts` is template-level, unaffected; check `public-actions` tests) still pass. Commit `feat(notifications): one seam for owner notices, with push`.

---

### Task 5: Reminder drain honours the org's policy

**Files:**
- Modify: `src/features/scheduling/reminders.ts`
- Modify: `src/app/api/scheduling/drain/route.ts`
- Test: `src/features/scheduling/reminders.test.ts`

**Interfaces:**
- `decideReminder(booking, now, opts: { overQuota?: boolean; leadMs?: number; disabled?: boolean })` — `disabled` → "suppress".
- `REMINDER_MAX_LEAD_MS = 48h`, `REMINDER_CANDIDATE_LIMIT = 200` (query), `REMINDER_BATCH_LIMIT = 25` (sends).
- `runReminderDrain` deps gain `customRemindersAllowed?: (orgId: string) => Promise<boolean>` (default true); the row join adds `notification_prefs` to `orgs(...)`; policy = `reminderPolicy(parseOrgPrefs(row.orgs?.notification_prefs), allowed)`.
- Route injects `customRemindersAllowed: async (orgId) => !plansEnforced(await flagsFor(orgId)) || (await entitlementsFor(orgId)).customReminders`.

- [ ] **Step 1: Tests** — `decideReminder` with `leadMs: 2h`: booking 3h out → wait, 1h out created yesterday → send; `disabled: true` → suppress. Drain-level: fake db with two rows (org A lead 1 h booking in 40 h → not touched; org B lead 48 h booking in 40 h → sent) proves a wait row does not consume the send cap.
- [ ] **Step 2:** implement; keep the "created inside the lead window → suppress" rule relative to the effective lead.
- [ ] **Step 3:** `npx vitest run src/features/scheduling/reminders.test.ts` — PASS. Commit `feat(notifications): reminder lead and on/off from org prefs`.

---

### Task 6: Queries and actions

**Files:**
- Create: `src/features/notifications/queries.ts`, `src/features/notifications/actions.ts`
- Modify: `src/lib/billing/badge-toggle.ts` → add `perkToggle(orgId, pick: (e: Entitlements) => boolean)`; `badgeToggle` becomes `perkToggle(orgId, (e) => e.hideBadge)`

**Interfaces:**
```ts
// queries.ts (server)
export async function getNotificationSettings(): Promise<{ member: MemberPrefs; org: OrgPrefs; devices: Array<{ id: string; endpoint: string; userAgent: string | null; createdAt: string }> }>;
// actions.ts ("use server")
export async function setMemberPref(input: { event: MemberEvent; channel: "email" | "push"; enabled: boolean }): Promise<ActionResult>;
export async function setReminderPrefs(input: { enabled: boolean; leadHours: ReminderLeadHours }): Promise<ActionResult>;   // refuses a non-24 lead when the plan pins it (server-side gate, same rule as the page)
export async function savePushSubscription(input: { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string }): Promise<ActionResult>;
export async function removePushSubscription(input: { id: string }): Promise<ActionResult>;
export async function sendTestPush(): Promise<ActionResult>;
type ActionResult = { ok: true } | { ok: false; error: string };
```
- `setMemberPref` reads the current row, merges, calls `update_member_notification_prefs` with the full object; `setReminderPrefs` calls `update_org_notification_prefs`.
- Errors: `getTranslations("errors")` → `t("generic")` (admin action idiom).

- [ ] **Step 1:** implement; `revalidatePath("/notifications")` after writes.
- [ ] **Step 2:** `npm run typecheck`; commit `feat(notifications): settings queries and actions`.

---

### Task 7: Page, components, nav, messages

**Files:**
- Create: `src/app/(dashboard)/notifications/page.tsx`
- Create: `src/features/notifications/components/push-devices.tsx` (client), `event-matrix.tsx` (client), `reminder-settings.tsx` (client), `always-sent.tsx` (server)
- Modify: `src/components/shell/nav.ts` (item `{ href: "/notifications", labelKey: "notifications", icon: Notification03Icon, section: "account" }` before Settings)
- Modify: `messages/en.json`, `messages/uk.json` (`shell.nav.notifications`, `notifications.*`)

**Behaviour:**
- `push-devices.tsx`: props `{ publicKey: string | null; devices; configured: boolean }`. On mount: `navigator.serviceWorker.register("/sw.js")` then `reg.pushManager.getSubscription()` → "this device" = its endpoint ∈ devices. Buttons: Enable (permission → subscribe → `savePushSubscription`), Turn off here (unsubscribe + remove), Remove (other devices), Send a test. States: not configured (no key) / not supported (`!("PushManager" in window)`, iOS hint) / enabled here / not enabled here.
- `event-matrix.tsx`: four rows × two `Switch`es, `useOptimistic` + `startTransition` + `setMemberPref`, toast on failure (`sonner`).
- `reminder-settings.tsx`: `Switch` enabled; lead picker as a dropdown (`DropdownMenu` with radio items) disabled + Pro chip linking to `upgradeHref` when `!canCustomize`; quota hint prop.
- Page: `requireOrg()`, `getNotificationSettings()`, `perkToggle(org.id, e => e.customReminders)`, quota from `getEntitlements` while `plansEnforced`. Layout mirrors `settings/page.tsx` (`PageIntro`, two `h2` groups, `SettingsCard`/`SettingsRow`).

- [ ] **Step 1:** messages (both files), nav, page + components.
- [ ] **Step 2:** `npm run verify`; the messages lint ratchet (`admin` English-leak rule) must pass.
- [ ] **Step 3:** Commit `feat(notifications): the /notifications page`.

---

### Task 8: QA, docs, PR

- [ ] Generate VAPID keys locally (`npx web-push generate-vapid-keys`), add to `.env.local`; run `npx next dev -p 3001 --webpack`; scripted Playwright at `http://localhost:3001`: log in as demo, open /notifications, grant permission (Playwright context `permissions: ["notifications"]`), Enable, Send a test (assert a `push_subscriptions` row and a 201 from the send), toggle a switch (row persists after reload), Free vs Pro lead picker.
- [ ] Book on the demo public page and confirm a push arrived (sw log) and the provider email still lands in Mailpit (`:54354/api/v1/messages`).
- [ ] Docs: `docs/runbook-production.md` env section gains the three VAPID vars and how to generate them.
- [ ] `graphify update .`; `npm run verify`; push; `gh pr create` with the spec summary and the SMS follow-up called out.
