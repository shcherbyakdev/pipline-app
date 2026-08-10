# Participants + /p/[token] — Slice 7 Design

**Date:** 2026-08-10
**Status:** Approved in brainstorm (including the six review amendments).
**Parent:** `2026-08-09-client-flow-vision-and-roadmap-design.md` (slice 7 of 7 —
the thesis slice). Builds on slice 6 (requirements, derivation, override).

## Goal

An external participant — a field engineer, an installer, a site contact —
opens a link on their phone, sees the units assigned to them, and fills in
the outstanding requirements. No account, no app, no login. Staff issue,
list, and revoke those links from the program page. This is the first
surface where the product does something no competitor's demo does.

## Decisions log

| Decision | Choice | Rejected |
|---|---|---|
| Console scope | Inside the program page (Assign per unit row + Links panel) | Dedicated /participants page (second CRUD surface before any external user exists); anonymous per-unit links (kills attribution and chasing) |
| Write path | **Token-keyed SECURITY DEFINER RPCs, anon-callable** — the DB trusts the token, not the caller | Service-role client + widened grants (god-key writes guarded only by TS convention); session-variable smuggling (PostgREST-awkward) |
| Validator | **One SQL function** `resolve_participant_token` is the sole validity authority; TS calls it, never re-implements it | Duplicated validation in TS + SQL (drift is what "one chokepoint" forbids) |
| Security boundary | **256-bit token entropy.** The TS rate limiter is DoS/noise hygiene only — the RPCs are reachable directly via PostgREST with the anon key, and that is acceptable *only because* brute force is physically infeasible. Never shorten tokens. | Pretending the rate limiter is load-bearing |
| Assignment drift | A token grants what its participant is **currently** entitled to: program-scoped tokens read live assignments; a unit-scoped token 404s if the unit is reassigned | Freezing scope at mint time |
| Renewal notify | Renewal page instructs "ask {org} for a new link"; **org notification deferred to slice 10** (no email infra until Resend) | Building one-off email now |

## Data model

```
participants
  id, org_id FK→orgs (cascade), name text NOT NULL,
  email text NULL, phone text NULL, created_at
  RLS: member CRUD (templates pattern) + explicit grants both roles.
  Duplicate names allowed in v1 (dedup UI post-v1).

access_tokens
  id, org_id FK→orgs (cascade),
  token_hash text UNIQUE NOT NULL         -- sha256 hex; the token is NEVER stored
  kind text CHECK in ('participant','portal')   -- portal used from slice 9
  participant_id FK→participants (cascade) NULL,
  program_id FK→programs (cascade) NULL,
  unit_id FK→units (cascade) NULL,        -- null ⇒ all currently-assigned units
  expires_at timestamptz NOT NULL, revoked_at NULL, last_used_at NULL,
  created_by uuid NOT NULL, created_at
  CHECK: kind='participant' → participant_id IS NOT NULL AND program_id IS NOT NULL
  Indexes: token_hash (unique), org_id, participant_id, program_id, unit_id.
  RLS: member select + insert; update column-scoped to revoked_at (revoke is
  the only member mutation). No delete (history is the audit trail).
  Explicit grants; service_role: select only (last_used_at is written by
  the definer resolve function, not by any API role).

units.assigned_participant_id            FK→participants ON DELETE SET NULL, indexed
unit_stage_responses.answered_by_participant_id
                                         FK→participants ON DELETE SET NULL;
                                         written ONLY inside the RPCs — no
                                         client column grant on either role
```

### The guard trigger (review amendment #1 — load-bearing)

RLS on `access_tokens` only proves the *minter* belongs to `NEW.org_id`; the
FKs point anywhere. Without more, a member could mint a token binding their
own org_id to a **foreign** program/participant, and resolution would hand
out cross-tenant scope. `access_tokens_check_org` (BEFORE INSERT OR UPDATE,
the `check_unit_org` pattern) enforces:

- `participant_id`'s org = `NEW.org_id`
- `program_id`'s org = `NEW.org_id`
- `unit_id` (when set): belongs to `NEW.program_id` and `NEW.org_id`

Its own integration test attempts the cross-org mint and must fail.

## SQL surface (all in one migration, the 0011 discipline)

```
resolve_participant_token(p_token text)
  → (status text, org_name text, org_id, participant_id, program_id, unit_id)
  SECURITY DEFINER; grant execute to anon only.
  digest(p_token,'sha256') hash lookup. status ∈ 'ok' | 'expired' |
  'revoked'; zero rows when unknown or kind <> 'participant'. Touches
  last_used_at (≤ once per 60s) on any hit. The ONLY validity logic in the
  system — TS routes on status ('ok' → flow, 'expired'/'revoked' → renewal
  page with org_name, no rows → 404) and never re-derives it.

submit_participant_response(p_token, p_requirement_id, p_value_text,
                            p_value_number, p_value_bool, p_value_date) → void
  SECURITY DEFINER; grant execute to anon ONLY (staff have their own path);
  revoke from public/authenticated/service_role (the derive_unit_stage
  lockdown discipline).
  1. scope := resolve_participant_token(p_token); anything but status='ok'
     → 'link not found'
  2. locate the unit_stage: requirement's program_stage × a unit that is
     IN SCOPE NOW — unit_id-scoped: that unit, still assigned to the
     participant; program-scoped: any unit currently assigned. No match →
     'requirement not found' (404-shaped — never reveals existence).
  3. upsert the response (ON CONFLICT the (unit_stage, requirement) unique),
     setting answered_by_participant_id := scope.participant_id.
     The slice-6 trust + derivation triggers fire unchanged.

clear_participant_response(p_token, p_requirement_id) → void
  Same shape; deletes the response if in scope (idempotent).
```

**Attribution symmetry (amendment #5):** the slice-6 prepare trigger gains
one branch — when `auth.uid()` IS NOT NULL (a staff write), it nulls
`answered_by_participant_id`; the RPC path already gets `answered_by_user_id`
nulled (auth.uid() is null under anon). The audit trail never shows both.

## lib/tokens (the TS chokepoint)

The only module that touches `params.token`. Duties: call
`resolve_participant_token` via an anon supabase client; rate-limit
resolutions (in-memory sliding window per IP+token-prefix, ~30/min —
DoS hygiene, resets on redeploy, fine local-only); never log tokens; map
"invalid" to notFound() and "expired/revoked" to the renewal page; perform
the flow's READS via the new server-only `lib/supabase/admin.ts`
(service-role), strictly filtered by the resolved scope (org_id + program_id
+ assigned/unit filter). Also exports `mintParticipantToken()` (32
random bytes → base64url; returns the raw token once + inserts the hash row
via the caller's authenticated client so RLS + guard trigger bind).

## Surfaces

**`/p/[token]`** — unit list: program name, org name, each in-scope unit
with outstanding-requirement count; a unit-scoped token skips straight to
its unit. Empty scope → "nothing outstanding". **`/p/[token]/units/[unitId]`**
— pending stages as sections with editable requirement fields (answered
values stay editable until the stage is done); done stages collapse to a
read-only summary line; NO override control (staff-only — it is the audit
line between 'requirements' and 'override'). Mobile-first layout. The
requirement field rendering is extracted from `unit-stage-sections.tsx`
into a shared presentational component; the participant version wires to
server actions that call the RPCs with the token.

**Renewal page** — expired/revoked tokens land on "This link has expired —
ask {org name} to send you a new one." (Org name via the hash row; accepted
minor disclosure, the Mollie precedent.) Unknown token → plain 404.

**Console (program page)** — unit rows gain an Assign control
(pick-or-create participant inline by name); a Links panel: issue per
participant (program-wide or single-unit), URL shown ONCE with copy
button, active links listed (participant, scope, issued, expires,
last used) with Revoke. Server actions: standard authenticated path
(`createParticipant`, `assignUnit`, `issueLink`, `revokeLink`).

## Hardening

- `Referrer-Policy: no-referrer` + `X-Robots-Tag: noindex, nofollow` on
  `/p/:path*` and `/portal/:path*` via `next.config.ts` headers().
- Scope miss → 404-shaped errors, never 403. Tokens never in logs.
- RPC execute grants exactly as listed above; everything else revoked.

## Testing

Integration (through the REAL surfaces — supabase-js `.rpc()` as anon, no
session): mint→resolve roundtrip; unknown/expired/revoked → null; cross-org
mint rejected by the guard trigger; **the core scope test: a token for
unit A cannot read or write unit B**, program-scoped token cannot touch an
unassigned unit, reassignment kills a unit-scoped token; submit satisfies
derivation and stamps `answered_by_participant_id`; staff re-answer flips
attribution (symmetry both ways); revoked-mid-session write rejected;
authenticated role cannot execute submit/clear RPCs; staff cannot write
`answered_by_participant_id` directly. Unit: mint/hash helpers, Zod inputs,
rate-limiter window math.

## Out of scope (deliberate)

Photo evidence (slice 8), org notification on renewal + reminder cadence
(10), SMS delivery (post-v1), per-stage assignment (post-v1), portal kind
usage (9), participant management page (post-v1), multi-instance rate
limiting (deploy-time concern; deploys disabled).
