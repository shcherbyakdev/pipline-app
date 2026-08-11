# Chasing — Slice 10 Design

**Date:** 2026-08-11
**Roadmap row:** `2026-08-09-client-flow-vision-and-roadmap-design.md`, slice 10.
**Done when:** an unanswered link reminds without human action; submission
cancels the chase.

## Scope decision

The roadmap row names four capabilities: send links, reminder cadence,
digests, escalation. V1 builds the first two — **email the participant their
link, then re-remind on a cadence until the assigned work is done**. Client
digests and staff escalation are deferred; both would add recipient types and
policy surface that the demo scene does not need. This also resolves roadmap
open question #4 (cadence defaults + a participant "stop reminding me"
affordance) — both decided below.

Everything here serves one sentence: an unanswered link reminds without human
action; submission cancels the chase.

## Decisions (settled in brainstorm, 2026-08-11)

1. **Scope:** send + remind the participant only. No digests, no escalation.
2. **Token strategy:** mint a fresh token per send; all stay live until
   expiry, completion, or revoke. Nothing raw is ever stored — the existing
   invariant (`generateAccessToken` returns the raw token exactly once; only
   the sha256 lands in `access_tokens`) is untouched. Completion revokes the
   chase's token *set*.
3. **Cadence:** hardcoded escalating backoff — offsets **[0, 3, 7, 14] days
   from chase creation**, 4 emails maximum, then permanent silence
   ("exhausted"). One `const` in code; no config surface.
4. **Opt-out:** every email footers a stop link → confirmation page (GET
   renders, POST acts — prefetch-safe). Confirming stops **this chase only**
   and surfaces in the console ("asked to stop being reminded"). The access
   link itself keeps working — only the emails stop.
5. **Scheduler:** own the state machine; no Inngest. A `chases` table +
   pure decision core + an authenticated drain route. What calls the route is
   swappable (local script now; GH Actions/Vercel Cron/pg_cron when
   deployed). *(Amends the roadmap's "Resend + Inngest": nothing is deployed,
   so Inngest Cloud cannot reach the app, and the cadence logic is ~40 lines.
   Resend stays — behind a transport seam.)*

## Data model

One new table. A chase mirrors the participant-token scope exactly —
`(participant, program, unit?)`, `unit_id` null = every unit currently
assigned — so "the chase" and "the link" describe the same thing.

```
chases
  id              uuid pk default gen_random_uuid()
  org_id          uuid not null → orgs (cascade)
  participant_id  uuid not null → participants (cascade)
  program_id      uuid not null → programs (cascade)
  unit_id         uuid null     → units (cascade)
  sends_done      int not null default 0
  next_send_at    timestamptz null      -- null = nothing scheduled
  stopped_at      timestamptz null      -- participant opted out
  completed_at    timestamptz null      -- work done (set by drain)
  last_error      text null
  attempt_count   int not null default 0
  created_by      uuid not null
  created_at      timestamptz not null default now()
```

- **Terminal states**, all distinguishable: *completed* (`completed_at`),
  *stopped* (`stopped_at`), *exhausted* (`sends_done = 4`,
  `next_send_at is null`).
- **Partial unique index** on `(org_id, participant_id, program_id,
  coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where completed_at is null and stopped_at is null` — a duplicate live
  chase is impossible (`coalesce` because Postgres unique indexes treat
  nulls as distinct).
- **`access_tokens.chase_id`** (nullable, `on delete set null`): links each
  minted token to its chase so completion revokes exactly the chase's tokens
  in one `UPDATE`. Hand-issued links (`chase_id` null) are never touched.
- **No delete policy.** Chases are history; terminal states are the archive.

### Cadence is derived, not accumulated

Offsets are measured from `created_at`, never from the last send:

```ts
export const CHASE_OFFSET_DAYS = [0, 3, 7, 14] as const;
nextSendAt(createdAt, sendsDone): Date | null   // pure
```

A late drain tick cannot push the schedule rightward (drain runs day 5 →
sends #1, next due stays day 7, not day 8). `next_send_at` is a materialized
derivation kept only so the due-query stays indexable.

### The decision core is pure and IO-free

```ts
decide(chase, { now, hasOutstandingWork }) →
  | { kind: 'send',     sendIndex, nextSendAt }
  | { kind: 'complete' }
  | { kind: 'skip',     reason }
```

`hasOutstandingWork` is passed in, not fetched — the entire cadence is
unit-testable with a fake clock and no database.

### Cancellation is lazy, by design

"Submission cancels the chase" resolves **at drain time**, not via a hook on
the submit action. Before every send the drain re-derives whether work is
outstanding; if none, it completes the chase and sends nothing. The
observable requirement — no email after the work is done — holds exactly,
and there is no hook to forget when a future slice adds another way to
complete a stage.

## Engine

### Chase creation — explicit, not automatic

`issueLink` stays as-is; copy-paste links keep working. New server action
`startChase(participantId, programId, unitId?)`:

- Requires `participants.email` to be present — validated up front with a
  clear error, not a silent skip.
- Creates the chase row with `next_send_at = created_at` (offset 0). It does
  **not** send — the drain picks it up, so there is one send path, not two;
  the initial email is just send #0 of the cadence.
- Console gets a "Send & chase" affordance beside the existing "Issue link".

### Drain route

```
POST /api/chase/drain      Authorization: Bearer CHASE_DRAIN_SECRET
```

- Secret compared with `crypto.timingSafeEqual`; `CHASE_DRAIN_SECRET` joins
  `env.ts` as an optional server-only var. No secret configured → route
  refuses (503), never runs open.
- Writes via the service-role client (`createAdminClient`) — the drain runs
  from a cron with no user session; the Bearer secret is the auth for this
  path. (Precedent: slice-9 token resolution already uses the admin client
  server-side.)
- Selects due rows: `next_send_at <= now() and completed_at is null and
  stopped_at is null`, `limit 25` per tick (bounded work; leftovers are
  simply still due next tick).
- Per chase: re-derive `hasOutstandingWork` from the same read models the
  participant flow uses → `decide()`:
  - **complete** → set `completed_at`; revoke all tokens
    `where chase_id = this and revoked_at is null` in one update.
  - **send** → mint a fresh token via the existing `generateAccessToken()`
    (insert carries `chase_id`; expiry = the standard participant default),
    render the email, hand it to the transport, then advance
    `sends_done`/`next_send_at` (send #4 → `next_send_at = null`,
    exhausted).
  - **skip** → record reason, continue.
- **Failure isolation:** one failed send writes `last_error`, bumps
  `attempt_count`, and leaves `next_send_at` unchanged — the row is simply
  still due next tick. Retry is a property of the state, not a mechanism.
- Returns `{ sent, completed, skipped, failed }` — v1 observability.

### Double-send safety, two independent layers

1. The row advance commits in the same transaction as the decision — a
   concurrent tick sees the moved `next_send_at`.
2. Every Resend call carries `Idempotency-Key: chase/{id}/send/{sendIndex}`
   (Resend deduplicates for 24h), so a race or crash-retry cannot produce a
   duplicate email.

### Transport seam — the only vendor-touching code

```ts
// src/lib/email/transport.ts
type EmailTransport = { send(msg: OutboundEmail): Promise<{ id: string }> }
```

- `resendTransport`: one `fetch` to `POST https://api.resend.com/emails`
  with a Bearer key. **No SDK — zero new npm dependencies** for sending.
  (Verified against Resend docs 2026-08-11: REST endpoint + Idempotency-Key
  header are the documented public surface.)
- `smtpTransport`: local dev, pointing at the Supabase mail catcher. The one
  config change this slice makes: uncomment `smtp_port = 54325` in
  `supabase/config.toml` (web UI already at :54354). If SMTP needs a client
  lib, prefer a dependency-free minimal client; if that proves unreasonable,
  `nodemailer` as a dev-adjacent dependency is acceptable — decide in the
  plan.
- Selection by env: `RESEND_API_KEY` present → Resend; else SMTP if
  configured; else the drain errors loudly rather than pretending to send.
- Tests inject a fake transport. Nothing in the core imports a vendor.

### Email templates

Plain functions returning `{ subject, html, text }` — template literals, no
react-email/MJML, testable by string assertion. One template family (sends
0–3) with gently escalating subjects ("Your inspection link" → "Final
reminder"). Body: org branding (accent + logo via the slice-9 read helper),
program/unit names, the fresh link, and the stop-link footer. Consistent
with the portal's data discipline, emails carry no other person's name.

### Stop affordance

Rides the participant token route — no new token kind, no new resolver:

```
GET  /p/[token]/stop     → confirmation page (renders even if chase ended)
POST (server action)     → anon-callable definer RPC stop_chase(p_token)
```

The token in the stop URL is the same fresh token that email carried. The
RPC follows the established participant-write pattern (verified in
`flow-actions.ts`: "the token is the credential and SQL is the authority") —
it resolves the token hash in SQL, finds the chase via the token's
`chase_id`, sets `stopped_at`, and returns nothing distinguishable on
failure (the 404 discipline). GET only renders — prefetch-safe. The console
unit page shows an amber "asked to stop being reminded" flag from
`stopped_at`.

### Trigger

`npm run chase:drain` — a small script that POSTs to the route with the
secret. On deploy, point GitHub Actions cron or Vercel Cron at the same URL;
nothing else changes.

## Security surface — migration `0019_chases.sql`

The 0013/0018 idiom: the whole surface in one reviewable custom-SQL file.

- **RLS on `chases`:** org members select/insert/update via the standard
  org-membership predicate. No delete policy.
- **Explicit GRANTs** per the standing convention (newer images drop default
  ACLs — the PR #8 lesson). `anon` gets **no grant on `chases`**; the stop
  write happens inside the definer RPC, so anon needs no direct table access.
- **Org-guard trigger** validating the scope tuple (participant, program,
  unit all in the chase's org), same shape as 0013's token guard.
- **`stop_chase(p_token text)`**: `security definer`, anon-executable,
  keyed on the token hash; uniform failure.
- `access_tokens.chase_id` FK `on delete set null` (belt and braces —
  chases aren't deletable anyway).
- Invariants preserved: no write RPC reachable by a *portal* token; the raw
  token never stored; a dumped database contains no usable links.

## Testing

Three layers, matching the repo's existing split:

1. **Unit (pure core):** `nextSendAt` + `decide` under a fake clock — the
   full cadence table; exhaustion at 4; stopped/completed short-circuits;
   the late-tick case; idempotency-key derivation; template string
   assertions.
2. **Integration (SQL surface), 0013/0018 style:** foreign org cannot see
   chases; anon cannot touch the table; org-guard rejects cross-org tuples;
   partial unique index rejects a duplicate live chase; `stop_chase` sets
   `stopped_at` via a valid token and fails uniformly on garbage;
   completion revokes exactly the chase's tokens, leaving hand-issued ones
   alive.
3. **Integration (HTTP drain), fake transport:** no secret → 401; due chase
   → one send recorded + token minted with `chase_id`; completed work →
   chase completes, zero sends; stopped chase → untouched; transport
   failure → `last_error` set, row still due; immediate second drain → zero
   sends.

The roadmap's "done when" is asserted directly: advance the fake clock past
an offset, drain, observe the send (reminds without human action); complete
the work, drain, observe completion and zero sends (submission cancels the
chase).

## Out of scope (deliberate)

- Client digests; staff escalation (deferred recipient types).
- Delivery webhooks / bounce handling — Resend's dashboard covers v1; a
  bounce column is a follow-up.
- Per-program cadence config; SMS; any change to the participant flow
  itself.
- **Noted, not fixed:** `participants.email` is nullable and format-
  unvalidated today. `startChase` validates presence; adding format
  validation at participant creation is a small pre-existing gap for a
  follow-up.

## New environment variables

| Var | Where | Required |
|---|---|---|
| `CHASE_DRAIN_SECRET` | server | optional in `env.ts`; drain refuses without it |
| `RESEND_API_KEY` | server | optional; absent locally (SMTP path) |
| `EMAIL_FROM` | server | optional with a dev default; the from address |
| `SMTP_URL` (or host/port pair) | server | optional; local Mailpit |

## Amendments (2026-08-11, post-review)

1. **Retry cap.** A chase's send attempts are capped at `CHASE_MAX_ATTEMPTS =
   5` (`drain.ts`). Once `attempt_count` reaches the cap, the drain gives up
   instead of retrying forever: it clears `next_send_at` (so the row drops
   out of every future due-scan) and records `last_error`, without minting
   another token. This bounds orphan tokens at 5 mints per chase — each one
   still dies at its own expiry or at completion, same as before. The
   console surfaces this as a new `"stalled"` status, distinct from
   `"exhausted"` (which means the chase finished its whole cadence
   normally, not that it gave up early).
2. **Live-scope index treats stalled/exhausted chases as non-blocking.**
   `chases_live_scope_uq` (0020) now requires `next_send_at is not null` in
   addition to `completed_at is null and stopped_at is null`. A chase that
   ran its cadence dry or hit the retry cap above no longer occupies its
   scope, so staff can start a fresh chase for the same
   (participant, program, unit) once the old one goes quiet — they are not
   stuck waiting on a dead row indefinitely.
