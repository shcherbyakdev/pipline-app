# Recurrence — Slice 11 Design

**Date:** 2026-08-11
**Roadmap row:** `2026-08-09-client-flow-vision-and-roadmap-design.md`, slice 11.
**Done when:** a completed unit re-enters the pipeline when its certificate
nears expiry.

## Scope decision

The roadmap row names four capabilities: due dates, expiry, re-arm, lapse
detection. This slice builds all four around **one driver**: a date
requirement whose value is a certificate expiry. When that date minus a lead
time arrives, the stage that holds it re-arms — responses archive, the stage
reopens, and a chase starts automatically. When the date passes with the work
still outstanding, the unit shows as lapsed. This resolves roadmap open
question #1 (**expiry-driven**, not program-schedule-driven; a schedule
fallback for stages without a date requirement is deliberately post-v1).

This is the slice that makes the vision doc's claim true — chasing as "the
default case, not a bolted-on cron job". Slice 10 built the reminder machine;
slice 11 makes the machine start itself.

## Decisions (settled in brainstorm, 2026-08-11)

1. **Model:** expiry-driven. A `date` requirement marked as the recurrence
   driver re-arms its stage at `value_date − lead_days`. No captured date →
   no recurrence.
2. **Re-arm semantics:** reset + archive. The stage flips back to `pending`;
   **all** of its current responses are marked superseded so the new round
   starts blank while the old round survives as rows. Evidence is untouched.
3. **Config:** one nullable column, `recur_lead_days`, on the requirement.
   Setting it (e.g. 30) both marks the date as the driver and sets the lead.
   No program-level config surface.
4. **Auto-chase:** re-arm starts a chase automatically when the unit has an
   assigned participant with an email; otherwise the stage just sits
   outstanding in the console. Not an error.
5. **Lapse visibility:** derived "lapsed" shows in **both** the staff console
   and the client portal — factual compliance state is what the portal is
   for.
6. **Engine:** the slice-10 drain-tick pattern — a pure decision core plus a
   scan phase riding the existing `POST /api/chase/drain` tick. No new
   infra, secrets, or dependencies. (pg_cron and check-on-read were
   considered and rejected: auto-chase needs the app runtime, and lazy
   re-arm on page view would only fire when a human looks.)

## Data model — three new columns, no new tables

```
template_stage_requirements.recur_lead_days  int null
program_stage_requirements.recur_lead_days   int null
  -- CHECK (recur_lead_days > 0)
  -- CHECK (recur_lead_days is null OR type = 'date')
  -- copied by the existing copy-on-use snapshot

unit_stage_responses.superseded_at  timestamptz null
  -- archive marker; null = live row, the only rows any read model sees

unit_stages.due_at  timestamptz null
  -- stamped at re-arm with the superseded driver's value_date;
  -- everything downstream (due / lapsed) derives from it
```

Consequences the migration must carry:

- The slice-6 unique index on `(unit_stage, requirement)` becomes partial —
  `where superseded_at is null` — so a fresh response is insertable after
  re-arm while duplicate *live* responses stay impossible.
- The derived-completion trigger treats superseded rows as absent.
- `chases.created_by` becomes nullable: null = started by recurrence, and
  the console renders it as "automatic".
- No stored "lapsed" status anywhere. Lapsed = `due_at < now()` and
  `status <> 'done'`, derived at read time — the same discipline as
  chasing's terminal states.

## Engine

### A recur phase inside the existing drain tick

`POST /api/chase/drain` runs two phases in order: **re-arm, then chase
sends** — a freshly re-armed unit's first email leaves in the same tick.
Same `CHASE_DRAIN_SECRET`, same cron, `npm run chase:drain` unchanged.

### Scan

Live driver responses on **done** stages whose window has opened:

```sql
select … from unit_stage_responses r
join program_stage_requirements q on … and q.recur_lead_days is not null
join unit_stages us on … and us.status = 'done'
where r.superseded_at is null
  and r.value_date - q.recur_lead_days <= current_date
limit 25
```

Bounded work per tick, like the chase drain; leftovers are still due next
tick. The existing `value_date` index (slice 6 placed it "for recurrence")
keeps the scan cheap at v1 scale.

### The decision core is pure and IO-free

```ts
rearmDue(valueDate, leadDays, now): boolean            // pure
decideRearm(row, { now }) →
  | { kind: 'rearm', dueAt }    // dueAt = the certificate's value_date
  | { kind: 'skip',  reason }
```

Fake-clock testable, no database — the slice-10 `decide()` idiom.

### Re-arm is one atomic action — a definer RPC

`recur_rearm(p_unit_stage_id uuid)`, `security definer`, executable by
`service_role` only:

1. Mark **all** the stage's live responses `superseded_at = now()`, guarded
   by `where superseded_at is null` — a concurrent tick supersedes zero rows
   and skips, so idempotency falls out: a superseded driver leaves the scan
   forever.
2. Flip the stage: `status = 'pending'`, clear `done_source`/`done_at`.
3. Stamp `due_at` with the driver's `value_date`.

An RPC rather than direct writes because of the standing grants convention:
`service_role` holds no direct update grants on `unit_stages` /
`unit_stage_responses` (the exact CI lesson behind commit `9254bc4`), and one
narrow definer function beats opening column grants on two tables.

### Auto-chase

After a successful re-arm, if the unit has `assigned_participant_id` and
that participant has an email, the drain inserts a chase
(`created_by = null`) with `on conflict do nothing` against the live-scope
unique index — an existing live chase for the same scope simply wins. The
chase-send phase then picks it up in the same tick. No participant or no
email → skip, recorded in the tick's counters, not an error.

Drain response gains recur counters: `{ rearmed, chasesStarted,
recurSkipped }` alongside the existing send counters.

## Surfaces — derived, no new pages

**Console (unit page stage row):**

- Stage still done, driver present → "expires {value_date}" straight from
  the live response.
- Re-armed, not yet past → amber **"renewal due by {due_at}"**.
- `due_at < now()` and not done → red **"lapsed {n} days"**.
- The superseded round renders as a collapsed read-only "previous round
  (archived {date})" block.
- Recurrence-started chases appear in the existing chase panel with creator
  "automatic".

**Portal:** the same amber/red markers on the affected unit, derived from
the same `due_at`. Read-only; the payload adds only the derived status —
never participant, chase, or email data (slice-9 data discipline).

## Security surface — one custom-SQL migration (0013/0018 idiom)

- New columns + the two CHECK constraints; unique-index swap to partial.
- `recur_rearm(p_unit_stage_id)` — `security definer`; `grant execute` to
  `service_role` only. Cross-org is impossible by construction (the function
  touches one unit_stage and its own rows), and neither `anon` nor
  `authenticated` can call it.
- Members gain update on `template_stage_requirements.recur_lead_days` (the
  editor input). `anon` gains nothing.
- Invariants preserved: no portal-token-reachable write; raw tokens never
  stored; a dumped database contains no usable links.

## Requirement editor

Date requirements in the template editor get one numeric input, "Re-arm N
days before". That is the entire config surface. Snapshots taken before this
slice have no driver and never recur — editing `recur_lead_days` on an
already-snapshotted program is out of scope.

## Testing

The repo's three-layer split:

1. **Unit (pure core):** `rearmDue` boundaries — exactly lead-days out,
   one day early, already past, no lead configured; `decideRearm` table
   under a fake clock.
2. **Integration (SQL surface):** `recur_rearm` is atomic
   (supersede + flip + stamp or nothing); a fresh response inserts cleanly
   after supersede while a duplicate live response still rejects; the
   completion trigger ignores superseded rows; `anon`/`authenticated`
   cannot execute the RPC; CHECK rejects `recur_lead_days` on a non-date
   requirement and non-positive values.
3. **Integration (HTTP drain, fake transport):** done stage with a
   near-expiry cert → re-armed + chase inserted + email #0 sent in one
   tick; immediate second drain → zero re-arms; no participant email →
   re-armed, no chase, no error; existing live chase → re-arm succeeds,
   chase insert no-ops; lapse derivation appears in both console and portal
   read models.

The roadmap's done-when is asserted directly: complete a unit whose stage
carries an expiry date, advance the fake clock into the lead window, drain —
the unit is back in the pipeline and the participant has a fresh link in
their inbox; advance past the expiry without completing — both surfaces show
lapsed.

## Out of scope (deliberate)

- Schedule-driven recurrence (intervals without a captured date) — the
  post-v1 fallback.
- Editing `recur_lead_days` on existing program snapshots.
- Re-arming anything beyond the driver's own stage (reopening one stage
  already makes the unit incomplete — it "re-enters the pipeline").
- Pre-expiry notification emails distinct from the chase cadence — the
  chase *is* the notification.
- Realtime portal refresh; SMS; per-unit lead overrides.

## New environment variables

None. The recur phase rides the existing drain secret and transports.

## Amendments (2026-08-11, pre-plan)

Found while mapping the spec onto the actual code; the *decisions* above are
unchanged, four *mechanisms* are corrected:

1. **Archive table, not a `superseded_at` column.** Staff response saves go
   through PostgREST upsert (`programs/actions.ts`:
   `onConflict: "unit_stage_id,program_stage_requirement_id"`), and
   PostgREST's `ON CONFLICT` cannot infer a *partial* unique index — the
   planned index swap would break every existing response write. Instead:
   a new `unit_stage_response_archive` table (same columns +
   `superseded_at`); `recur_rearm` copies the round there and **deletes**
   the live rows. The live table keeps its constraint, every upsert path,
   and the derivation trigger untouched.
2. **Old photos detach, by existing design.** `evidence.response_id` is
   `on delete set null` ("evidence survives its response — the audit
   trail"), and 0015's derivation requires response + link for photo
   satisfaction. So re-arm's delete detaches the previous round's photos:
   they survive in the table and storage but leave the per-requirement
   display, and the new round starts blank — exactly the reset+archive
   semantics. The archived-round block shows scalar values only in v1.
3. **`access_tokens.created_by` becomes nullable too.** `mint_chase_token`
   copies `chases.created_by` into the token row; a system-started chase
   (`created_by` null) therefore needs the token column nullable as well.
   Null = minted for an automatic chase.
4. **The due-scan is an RPC.** PostgREST cannot express the per-row
   `value_date - recur_lead_days <= today` comparison, so the scan lives in
   `recur_due(p_today date, p_limit int)` — `security definer`,
   `service_role`-only, `p_today` injected so tests can time-travel. The
   pure `decideRearm` gate stays app-side as specified.
