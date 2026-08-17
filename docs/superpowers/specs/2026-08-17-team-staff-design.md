# Team — multiple staff members on one org (appointments)

**Date:** 2026-08-17
**Status:** Approved (brainstorm with Andrii)
**Parent:** `2026-08-13-scheduling-pivot-vision-and-roadmap-design.md` (actor model: "one bookable calendar per org" — this spec replaces that with "one calendar per staff member, ≥1 per org").
**Base:** `worktree-rentals-r3` @ `23512ec` (rentals parked behind `RENTALS_ENABLED`; last migration `0039_rentals_r2_rpcs.sql`). The parked R3 spec references `0040_org_modes.sql`; this slice takes `0040`, R3 renumbers when un-parked.

## Decision

Today availability, slots, the double-booking guard and every booking belong to the **org**. An admin who employs several workers cannot model them. This slice introduces a **`staff`** entity and re-keys the appointment engine to it, with one hard rule:

> **Solo stays solo.** Every org always has ≥1 active staff row (the account creator's). While `count(active staff) = 1`, no screen shows the staff layer — public page, calendar, availability editor and emails behave exactly as they do today. There is no "solo mode" flag; the count *is* the mode.

Decisions with rejected alternatives:

- **Staff are admin-managed, no login.** Admin creates/edits them; they have no account. `staff.user_id` (nullable, unique) is reserved so a later "invite staff" slice can attach a login without a migration of the model. *Rejected:* staff = `org_members` rows (needs placeholder auth users); building invites now (~2× scope).
- **`staff_id NOT NULL`** on availability rules, exceptions and appointment bookings; the migration creates one staff row per existing org and backfills. *Rejected:* nullable `staff_id` = "org-level / unassigned" — the EXCLUDE guard cannot protect null rows, the slot engine would merge two layers, and "unassigned" bookings would leak into every screen.
- **Per-staff availability; new staff copies the schedule of the first active staff** at creation. There is no separate "org business hours" table — the owner's row *is* the default. *Rejected:* org hours + per-staff overrides only (part-timers with different weekly patterns can't be modelled); dropping org-level entirely (same as chosen — the org-level rows simply become the first staff's rows).
- **Services ↔ staff many-to-many, all-assigned by default** in both directions (`service_staff`). *Rejected:* opt-in (more clicks for the salon case); no mapping (breaks with the first specialist).
- **Public flow: service first, then a staff step only when >1 eligible staff**, offering **"Anyone available"** first plus named staff. Per-staff pages (`/book/[handle]/[staffSlug]`) cover the staff-first / "my own link" case without an org setting. *Rejected:* staff-first ordering; an org toggle (YAGNI — revisit if asked).
- **"Anyone" auto-assignment happens in the DB** (least confirmed bookings that day, tie → lowest `sort_order`, race-safe retry) — never in the client. *Rejected:* client picks a staff id from the union (racy, exposes assignment logic).
- **Admin calendar: staff filter + colour per staff**, no per-staff columns. *Rejected:* side-by-side day columns (new layout; follow-up slice if wanted).
- **Optional staff email → new/cancel notice**, same template as the provider notice. Admin always gets everything.
- **Offboarding = deactivate only, refused while confirmed future bookings exist** (admin moves/cancels them first — R2 move exists), and refused for the last active staff. No hard delete; history stays intact. *Rejected:* auto-unassign (nullable model), auto-cancel with client emails.
- **Rentals untouched.** Rental bookings carry `rental_unit_id`, not `staff_id`; the unit guard is unchanged.

## Data model — migration `0040_staff.sql` (custom SQL, security-surface idiom)

Drizzle schema additions in `src/db/schema/scheduling.ts` (`staff`, `serviceStaff`, three `staffId` columns); CHECKs, RLS, grants, triggers, guard rebuild and RPCs in the SQL file.

### `staff`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| org_id | uuid → orgs cascade | |
| name | text not null | `length between 1 and 80` |
| slug | text not null | `(org_id, slug)` unique; same format CHECK as `orgs.handle` (lowercase, `[a-z0-9-]`, 2–40); auto-derived from name in the action, editable |
| email | text null | lowercased; never exposed to anon |
| color | text not null | hex CHECK (`accent_color` idiom); default assigned round-robin from a fixed palette in the action |
| active | bool not null default true | |
| sort_order | int not null default 0 | |
| user_id | uuid null unique | reserved for staff logins; unused in this slice |
| created_at | timestamptz | |

Indexes: `(org_id)`, `(org_id, active, sort_order)`. RLS: org-member select/insert/update via `user_orgs()`; **no delete policy**; **no anon grants** — the public page reads staff through the admin client (`lib/booking/public.ts` precedent), selecting only `id, name, slug, color`.

Column-write guard: a BEFORE UPDATE trigger `staff_guard_update` refuses `active := false` when (a) it is the org's last active staff, or (b) a confirmed booking with `starts_at > now()` references it — raising `'last_active_staff'` / `'has_future_bookings'` so the action can show a precise message. `org_id`/`user_id` are immutable in the same trigger.

### `service_staff`
`(org_id, service_id → services cascade, staff_id → staff cascade)`, PK `(service_id, staff_id)`, index `(staff_id)`. Org-consistency trigger (`check_booking_org` idiom): both parents must share `org_id`. RLS: org-member select/insert/delete via `user_orgs()` (untick = delete row; no update policy — the pair *is* the row). No anon grants.

### Re-keyed tables
- `availability_rules.staff_id`, `availability_exceptions.staff_id`: add nullable → backfill → `not null`, FK `staff cascade`. Indexes `(staff_id, weekday)`, `(staff_id, date)`. The two 0035 overlap EXCLUDEs (`availability_rules_no_overlap`, `availability_exceptions_no_overlap`) are dropped and recreated with `staff_id` in place of `org_id`.
- `bookings.staff_id`: add nullable, FK `staff` **restrict**; backfill for `service_id is not null`; CHECK `bookings_staff_iff_service` (`(service_id is null) = (staff_id is null)`), mirroring `bookings_unit_iff_rental`. Index `(staff_id, starts_at)`.
- Guard: drop `bookings_no_overlap`, recreate as `exclude using gist (staff_id with =, tstzrange(starts_at, ends_at) with &&) where (status = 'confirmed' and staff_id is not null)`. The rental guard is unchanged.

### Backfill (same migration, one transaction)
For every org: insert one staff row with `name = org.name`, `slug` derived from the org name in SQL (lowercase, non-`[a-z0-9]` runs → `-`, trimmed, clamped to 40; fallback `team-member` when empty), `color` = first palette entry, `sort_order 0`; point all rules/exceptions/appointment bookings at it; insert `service_staff` for every existing service. `create_org` (0001) is extended (`create or replace`) to insert this first staff row (`name = p_name`, i.e. the org name; the onboarding screen may rename it), so the invariant "≥1 staff" holds from creation.

### RPC changes (all `create or replace`, `search_path=''`, definer)
- `slot_within_availability(p_staff_id uuid, …)` — the `p_org_id` parameter is replaced by `p_staff_id`; body filters rules/exceptions by staff.
- `staff_is_free(p_staff_id, p_starts, p_ends, p_exclude_booking_id)` — helper: no confirmed overlapping booking for the staff (other than the excluded id). Revoked from all roles.
- `pick_staff_for_slot(p_service_id, p_starts, p_ends, p_timezone)` — helper: eligible = `service_staff` ∩ `active`; filter by `slot_within_availability` + `staff_is_free`; order by confirmed bookings on that org-local date asc, `sort_order`, `created_at`; returns the first id or null. Revoked from all roles.
- `create_booking(…, p_staff_id uuid default null)` — new trailing param (existing anon grant re-issued for the new signature; old signature dropped). Non-null: must be active + in `service_staff` for the service, else `'staff_unavailable'`; containment + guard as today but per staff. Null: `pick_staff_for_slot`; if the insert hits the EXCLUDE guard (`exclusion_violation`), retry once with the picker excluding the loser (loop ≤ eligible count); none left → `'taken'`. Returns `staff_id, staff_name` in addition to the current columns.
- `create_booking_admin(…, p_staff_id uuid)` — **required** (admin always chooses; the dialog defaults it). Same eligibility check; no throttle/notice/window as today.
- `reschedule_booking(p_token, …)` — keeps the old row's `staff_id`; containment/guard per staff. Returns `staff_name`.
- `reschedule_booking_admin(p_booking_id, …, p_staff_id uuid default null)` — null → same staff (dates-only), non-null → move to that staff (eligibility checked). Returns `staff_changed bool` alongside the existing columns.
- `cancel_booking`, `rotate_booking_token`, `resolve_booking_token`: return `staff_name` where they return `service_name` (manage page header).
- `update_org_scheduling` unchanged.

Existing integration tests for these RPCs are updated to pass/expect staff ids; new ones listed under Testing.

## Slot engine (`src/features/scheduling/slots.ts`)

`computeSlots(SlotInput)` is unchanged — it already takes rules/exceptions/busy for *one* calendar; callers now pass one staff's data.

New pure helpers (tested):
- `unionSlots(perStaff: { staffId: string; slots: Date[] }[]): { startsAt: Date; staffIds: string[] }[]` — merged, sorted, deduped by instant, with the eligible staff per slot (the confirm panel can say "with Anna" only after the DB assigns; the union is for display only).
- `assignByLoad(...)` is **not** implemented in TS — assignment is DB-only (single source of truth).

`lib/booking/public.ts`:
- `listPublicStaff(orgId, serviceId?)` → `{ id, name, slug, color }[]` active, ordered; filtered through `service_staff` when `serviceId` given.
- `getPublicStaffBySlug(orgId, slug)` → same shape or null (inactive → null).
- `getAvailability(staffId)`, `getBusyIntervals(staffId, …)`, `loadOrgSlotContext(orgId, serviceId, { staffId | 'any' })` → for `'any'` loads every eligible staff's rules/exceptions/busy and returns `perStaff[]`; the server action `getSlots` computes per staff and unions.

## Public booking pages

| Entry | URL | Bookable set | Flow |
|---|---|---|---|
| Org page | `/book/[handle]` | all active staff | Service → **staff step (only if >1 eligible for that service)**: "Anyone available" (default, first) + staff chips (colour dot/initials + name) → date & slots (chosen staff's, or the union) → details → confirmation shows the assigned staff name |
| Staff page | `/book/[handle]/[staffSlug]` | that staff | Header = org branding + staff name; services = that staff's active services; no staff step; slots = their calendar; 404 when slug unknown or inactive |
| Embed | `/embed/[handle]` and `/embed/[handle]?staff=[slug]` | as above | Same flows inside the iframe; the Website-embed studio gets "Book with: whole team / *person*" which writes the `?staff=` param into the snippet (only shown when >1 staff) |
| Manage / reschedule (tokenized) | unchanged URLs | the booking's staff | Header shows staff name; reschedule slot list is that staff only. Changing person is admin-only |

Solo org: the staff step never appears; `/book/[handle]/[slug]` resolves but nothing links to it.

`createBooking` (public action) gains `staffId: string | 'any'`; zod schema in `schema.ts` updated; the widget's `postMessage` payload unchanged.

Emails (`templates.ts`): client confirmation/reschedule/cancel/reminder gain a "with {staff}" line **only when the org has >1 active staff** (template receives `staffName | null`; the loader passes null in solo). Provider notice unchanged; **staff notice** = same provider-notice template sent to `staff.email` when set, on create/cancel/reschedule (admin and client-initiated). ICS `SUMMARY` gets " with {staff}" under the same rule.

## Admin

### Team page — `/team` (Configure group, next to Services; nav item always visible)
- List: colour dot, name, services count, active toggle, **own booking link** (`/book/[handle]/[slug]`) with copy button + "embed snippet" link to the embed studio pre-filtered.
- Add/edit dialog: name, slug (auto, editable), email, colour (palette), services checklist (all pre-checked on create), active. Copy-schedule-from on create: "Start with {first active staff}'s hours" (always on, informational).
- Deactivate refusal surfaces the trigger's reason: "Anna has 3 upcoming bookings — move or cancel them first" / "You need at least one active team member".
- Actions (`src/features/scheduling/staff-actions.ts`): `createStaff`, `updateStaff`, `setStaffActive`, `setStaffServices`. `createStaff` calls a definer RPC `create_staff(p_name, p_slug, p_email, p_color, p_service_ids uuid[]) returns uuid` (authenticated; org via `user_orgs()`), which inserts the row, copies the first active staff's rules + future exceptions, and fans out `service_staff` — one transaction. Updates/toggles/service ticks are direct RLS writes.

### Availability page
When >1 active staff: a segmented staff selector at the top (URL `?staff=<id>`, default first active); everything below edits that staff's rules/overrides. `getAvailabilityAdmin(staffId)`, all rule/override actions take `staffId` (schema-validated, RLS enforces org). Solo: identical to today (the single id is resolved server-side).

### Services page
Service form gets a "Team members" checklist (all checked by default) when >1 staff; `createService`/`updateService` write `service_staff`. Solo: hidden; the row is written automatically. Creating a service in solo still inserts the join row.

### Calendar (`/bookings`, week/day) and list
- When >1 active staff: filter chips (All + one per staff, multi-select, persisted in URL `?staff=a,b`); events carry the staff colour (left border/pill) and initials; hover/detail shows the name.
- Walk-in dialog: staff select (defaults to the single filtered staff, else first eligible for the chosen service; options filtered by `service_staff`); slots come from `getAdminSlots(serviceId, staffId)`.
- Booking detail → Reschedule: staff select ("keep Anna" default) — moving to another staff uses `reschedule_booking_admin(p_staff_id)`; slot list follows the selected staff.
- List view / clients page bookings: staff column when >1.
- Stats (`/overview`): unchanged for MVP (org-wide); per-staff breakdown is a follow-up.

### Onboarding
Unchanged screens; `create_org` seeds the first staff row named after the org. (Renaming yourself is done on the Team page.)

## Error handling
- RPC errors mapped in actions: `'staff_unavailable'` → "That team member can't take this service/time", `'taken'` unchanged, `'last_active_staff'`, `'has_future_bookings'`.
- Public page: staff slug 404 → `notFound()`; `?staff=` on embed with unknown/inactive slug → falls back to the org flow (never a broken iframe).
- Public server action rejects `staffId` not in the eligible set (defence in depth; the RPC also checks).

## Testing
- **Unit (Vitest):** `unionSlots`; slug derivation; schema changes (`schema.test.ts`); templates with/without staff line; ICS summary.
- **Integration (existing `*.integration.test.ts` pattern against local Supabase):**
  - migration: every existing org has exactly one staff, all rules/exceptions/appointment bookings backfilled, `service_staff` complete;
  - guard: two staff, same slot → both succeed; same staff → second raises;
  - `create_booking` with `p_staff_id null` picks least-loaded, and survives a concurrent insert (retry path);
  - `p_staff_id` not in `service_staff` → `'staff_unavailable'`;
  - `reschedule_booking` keeps staff; `_admin` with `p_staff_id` moves and reports `staff_changed`;
  - trigger: deactivate last active → error; deactivate with future booking → error; with only past bookings → ok;
  - RLS: anon cannot select `staff`/`service_staff`; member of org B cannot read/write org A staff; `create_staff` copies the source schedule atomically.
- **E2E (Playwright, existing booking flow spec):** solo flow byte-for-byte unchanged (no staff step); 2-staff org: "Anyone" books and shows assigned name; named staff page books only that person; deactivated staff page 404s.

## Out of scope (follow-ups)
- Staff logins / invites (`user_id` reserved).
- Per-staff columns in the day view; per-staff stats; per-staff pricing/duration; staff photos; staff-specific buffers.
- Org setting for staff-first ordering.
- Client "preferred staff" memory.
