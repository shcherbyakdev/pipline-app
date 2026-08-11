# Clients + Portal — Slice 9 Design

**Date:** 2026-08-10
**Status:** Approved in brainstorm (this doc is the written record).
**Parent:** `2026-08-09-client-flow-vision-and-roadmap-design.md` — slice 9 (★
thesis-critical). The token rules, standing constraints, and "never the
vault" posture in that doc apply verbatim and are not restated here.

## What this slice delivers

The customer's customer gets a live, branded, read-only view of their own
sites. Concretely:

- `clients` table + `units.client_id` — the grouping the portal is scoped to.
- `/portal/[token]` — long-lived, read-only, client-scoped token surface
  showing that client's units **across all programs**.
- Org branding (accent colour + logo) applied to both `/portal` and `/p`.
- Console: `/clients` list, `/clients/[id]` detail with the portal links
  panel, and a client picker on unit rows.

Done when the roadmap's demo scene holds: a participant submits on
`/p/[token]`, and the client's branded portal reflects it on next load.

## Decisions log (brainstorm 2026-08-10)

| Decision | Choice | Alternatives rejected |
|---|---|---|
| Portal depth | Status + evidence: done stages expand with answers + photos; pending stages are one "awaiting" line | Status-only board; full read-only mirror of the staff unit page |
| Branding scope | Accent colour + logo upload, new settings surface, applied to `/portal` and `/p` | Accent-only; defer branding entirely |
| Console shape | `/clients` nav page + `/clients/[id]` detail owning the links panel; per-unit picker on unit rows | Inline-only (no nav page); bulk multi-select assignment |
| Attribution on portal | Dates only, never names — enforced at the type level | Show names; per-org toggle |
| Logo formats | PNG/JPEG/WebP, max 1 MB — **no SVG** (scriptable format on a directly-navigable public URL) | Allowing SVG |
| Token RPC shape | Second dedicated `resolve_portal_token`, each resolver filtering its own `kind` | Generalised `resolve_access_token` (widens blast radius of the battle-tested participant resolver) |
| Branding delivery | `getOrgBranding(orgId)` admin-client helper used by both surfaces | Growing the resolvers' return tables (forces drop + recreate + re-grant of `resolve_participant_token`; puts display columns in anon-reachable SQL) |
| Client deletion | Allowed; tokens cascade, units set null | RESTRICT while link history exists (client becomes permanently undeletable; diverges from the participants precedent) |

## Data model

```
clients                              NEW
  id           uuid pk default gen_random_uuid()
  org_id       uuid not null → orgs on delete cascade
  name         text not null
  created_at   timestamptz not null default now()
  UNIQUE INDEX on (org_id, lower(name))   -- a duplicate "Acme Retail Ltd"
                                          -- is a typo, not a case
  INDEX (org_id)

units.client_id                      NEW
  uuid null → clients on delete set null, indexed
  guard trigger check_unit_client BEFORE INSERT OR UPDATE OF client_id, org_id:
    client.org_id must equal unit.org_id
    (mirrors check_unit_assigned_participant, 0013; a cascade SET NULL
     passes through — null skips the check)

access_tokens.client_id              NEW
  uuid null → clients on delete cascade, indexed
  CHECK access_tokens_portal_scope_check:
    kind <> 'portal' OR (client_id IS NOT NULL
      AND participant_id IS NULL AND program_id IS NULL AND unit_id IS NULL)
  participant CHECK tightened (drop + re-add):
    kind <> 'participant' OR (participant_id IS NOT NULL
      AND program_id IS NOT NULL AND client_id IS NULL)
    -- safe: the column is new, every existing row has client_id null
  check_access_token_org() extended with a kind = 'portal' branch:
    client must exist and belong to new.org_id

orgs.accent_color                    NEW
  text null CHECK (accent_color ~ '^#[0-9a-f]{6}$')  -- normalised lowercase
orgs.logo_path                       NEW
  text null  -- object path in the `branding` bucket
```

The portal token is **client-scoped only** — no program, no unit. The CHECK
makes narrower portal tokens unrepresentable; per-program portal links are
post-v1, and adding them later relaxes a CHECK rather than reinterpreting
data.

### Grants, RLS, lifecycle

- `clients`: RLS member CRUD (the `participants` policy set from 0013,
  including delete — no token-table asymmetry); explicit grants: full CRUD to
  `authenticated` and `service_role` (standing constraint — every new table
  ships explicit GRANTs). 0013's default-privileges revoke means the table is
  born anon-free; nothing further needed for `anon`.
- `units`: additive `GRANT UPDATE (client_id) TO authenticated` — the 0008
  column-scoped idiom, exactly how 0013 added `assigned_participant_id`.
- `orgs`: **no new grants.** It stays select-only for `authenticated`
  (0004's least-privilege rule); branding writes go through the
  `update_org_branding` SECURITY DEFINER RPC below.
- **Deleting a client cascades its tokens and nulls its units.** This is
  deliberate and precedented: participant deletion already cascades that
  participant's tokens, and 0013's "no delete policy: token history is the
  audit trail" guards *direct member deletes* of token rows, not lifecycle
  cascades (which run at the FK level, past grants and RLS — the Feature #4
  cascade lesson). When the audit subject is gone, its link history goes
  with it.

## Token surface

### `resolve_portal_token(p_token text)`

A second SECURITY DEFINER RPC alongside `resolve_participant_token` —
deliberately **not** a generalised resolver. Each function filters on its own
`kind`, so cross-kind confusion is structurally impossible: a portal token is
simply *not found* by the participant resolver, and vice versa. Both
directions get an integration test.

Same skeleton as 0013's resolver: length guard (20–200), sha256 via
`extensions.digest`, `search_path = ''`, uniform empty-result "not found",
throttled `last_used_at` update (60-second window — revocation hygiene per
the vision doc's token rules), and the same `revoked`/`expired`/`ok` status
derivation. Returns:

```
status text, org_id uuid, org_name text, client_id uuid, client_name text
```

`REVOKE ALL ... FROM public, anon, authenticated, service_role` then
`GRANT EXECUTE TO anon` — the 0013 idiom.

**No write RPCs exist for portal tokens.** Read-only is not a UI property;
there is no SQL a portal token can reach that writes.

### `lib/tokens` split

`src/lib/tokens/index.ts` is ~240 lines doing three jobs; this slice works
in it, so it gets the targeted split:

```
lib/tokens/index.ts        barrel: re-exports + clientKeyFrom + the shared
                           SlidingWindowLimiter (both surfaces draw from
                           the same 120/min noise floor)
lib/tokens/participant.ts  moved VERBATIM: resolveParticipantToken,
                           getParticipantUnits, getParticipantUnitDetail,
                           buildParticipantUrl
lib/tokens/portal.ts       new: resolvePortalToken, getPortalUnits,
                           getPortalUnitDetail, buildPortalUrl
```

Chokepoint discipline is unchanged: `lib/tokens` remains the only module
that hands a raw token to the database; no route reads `params.token`
directly.

## Portal read model

**The rule that keeps the portal from becoming a dashboard: a done stage
expands; a pending stage is a name plus "awaiting".**

One sentence, and it settles every edge case: a half-answered stage shows
nothing, the client never sees the org's internal checklist before it is
satisfied, and the read model never renders an empty requirement list.

- **Home** (`/portal/[token]`): the client's units grouped by program, each
  with done/total stage counts and a last-activity stamp. Units with
  `client_id IS NULL` do not exist as far as any portal token is concerned.
- **Last activity** = `greatest(max(unit_stages.done_at),
  max(unit_stage_responses.updated_at))` per unit; null renders as "no
  activity yet". (Stage `done_at` alone misses in-progress work; response
  `updated_at` alone misses overrides.) One aggregate query for the page.
- **Unit detail** (`/portal/[token]/units/[unitId]`): stages in position
  order. Done stages show `done_at` and their answered requirements —
  label + typed value, photos as signed thumbnails via the existing
  `signEvidencePaths` helper (evidence timestamps shown, e.g. "added 14
  Aug"). Pending stages render label + "awaiting" only.
- **Attribution is excluded at the type level.** `PortalUnitDetail` and its
  children have no field that can carry a person's name — the portal queries
  never join `participants` or user tables, so no future edit can leak a
  name by forgetting a filter. Dates only, per the brainstorm decision: the
  engineer's name is personal data on a long-lived forwardable link.
- Every admin-client query carries its own explicit `org_id` **and**
  `client_id` filters (slice-8 rule: never rely on an earlier check for
  tenancy).
- Expired/revoked tokens render the org-named "link no longer active" page —
  parity with `/p`'s current behaviour. Rate limiting via the shared
  limiter, same `clientKeyFrom` bucket.
- Freshness is on-load; no Realtime (post-v1, per the vision doc).

`/portal/:path*` already ships `Referrer-Policy: no-referrer` +
`X-Robots-Tag: noindex` (slice 7 pre-wired it in `next.config.ts`), and
`updateSession` never redirects — the proxy needs **no** change for the
portal to be reachable logged-out.

## Branding

- **Storage:** public-read `branding` bucket; writes only via the admin
  client; **zero storage RLS policies** (the slice-8 bucket-authority
  precedent). Logos are not secrets — public read means no signing on every
  portal load. Path: `org_id/logo-<sha256(bytes)>.<ext>` — content-hashed,
  so replacement busts caches for free; the org_id prefix is an unguessable
  uuid and bucket listing is not public.
- **Formats:** PNG, JPEG, WebP; 1 MB max, enforced server-side. Unlike
  slice 8's photo path (a declared-MIME allowlist only), the logo path also
  sniffs the buffered bytes' magic numbers against the declared MIME before
  upload — because `branding` is a public, directly-navigable bucket, a
  declared-MIME check alone would let a relabeled scriptable file (e.g. SVG
  bytes sent as `image/png`) through. No SVG.
- **`update_org_branding(p_org_id, p_accent_color, p_logo_path)`** —
  SECURITY DEFINER, `search_path = ''`, verifies `p_org_id IN
  (SELECT public.user_orgs())`, and **prefix-checks `p_logo_path` against
  `p_org_id || '/'`** (the `record_photo_evidence` precedent — defence in
  depth even though the server action derives the path itself). Nulls clear
  the respective field. `GRANT EXECUTE TO authenticated` only.
- **Replace/remove:** upload new object → RPC update → delete the old
  object; per the slice-8 compensation lesson, cleanup does not fire on
  transport errors (an ambiguous failure must not delete bytes the DB may
  still reference).
- **Settings surface:** new `/settings` route in the dashboard shell
  (sidebar entry): accent colour hex input + logo upload/replace/remove,
  with a live header preview.
- **Delivery:** `getOrgBranding(orgId)` — a small admin-client read of
  `orgs.accent_color`/`logo_path` used by the `/p` and `/portal` layouts.
  The token RPCs stay identity/scope-only. A shared `BrandedHeader`
  component (logo + org name + accent underline) renders on both surfaces;
  accent colour is applied via inline style from the CHECK-validated hex.

## Console

- **Nav:** Programs · Templates · Clients, plus a Settings sidebar entry.
  Command palette gains the Clients page entry.
- **`/clients`:** list (name, unit count, live-link count) + create dialog.
- **`/clients/[id]`:** rename/delete header; the client's units across all
  programs (program name, unit name, stage progress, linking to the unit
  page); the **portal links panel** — issue (raw link shown once, copy
  button), issued/expires dates, revoke. Default expiry 12 months; rotation
  = mint new, then revoke old. Delete confirms with the cascade consequence
  spelled out ("portal links are deleted; units keep their history but lose
  the client grouping").
- **Unit rows** (`/programs/[id]`): a client picker beside the existing
  participant picker — same interaction pattern as Assign.
- **Actions** (`features/clients/`): `createClient`, `renameClient`,
  `deleteClient`, `assignClient` (unit → client), `issuePortalLink`,
  `revokePortalLink`. Zod schemas mirror the participants feature; link
  minting reuses the 256-bit generator in `lib/tokens/mint.ts`, renamed to
  the kind-agnostic `generateAccessToken` (participant call sites updated —
  same entropy, same hashing).

## Tests

Unit (Vitest):
- client/branding/link Zod schemas; hex normalisation; logo mime/size
  validation; portal read-model mapping — the done-expands rule, the
  last-activity `greatest()` rule, and that pending stages carry no values.

Integration (the core assertions run over the real surfaces):
- **Scope:** a portal token for client A cannot read client B's units; units
  with null `client_id` are invisible to every portal token.
- **Kind isolation:** a portal token is not found by
  `resolve_participant_token`; a participant token is not found by
  `resolve_portal_token`.
- **Lifecycle:** expired → `expired`, revoked → `revoked` (not a 404);
  `last_used_at` updates on portal resolution.
- **Schema guards:** portal-scope CHECK rejects a portal token with
  program/unit/participant set or client missing; tightened participant
  CHECK rejects a participant token carrying a client_id;
  `check_access_token_org` rejects a cross-org client; `check_unit_client`
  rejects assigning a cross-org client to a unit.
- **Lifecycle cascades:** deleting a client deletes its tokens and nulls
  its units' `client_id`.
- **Branding:** `update_org_branding` rejects non-members and a `logo_path`
  outside the caller's org prefix; `orgs` remains unwritable directly by
  `authenticated`.
- **RLS/grants:** member CRUD on `clients` works; cross-org denied; grants
  present (the CI-image lesson).

## Explicitly not in this slice

Vanity slugs, custom domains, Realtime updates, per-program portal links,
client contact records or emails (chasing owns that — slice 10), client
logins, portal-side "request a new link" org notification (parity with `/p`,
which doesn't notify either — both belong to slice 10's messaging rail).
