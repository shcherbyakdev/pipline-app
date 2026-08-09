# Product Vision & v1 Roadmap — Client-Facing Pipeline Flows

**Date:** 2026-08-09
**Status:** Approved in brainstorm (this doc is the written record).
**Supersedes:** the positioning section of `2026-08-07-rolloutos-mvp-design.md`.
The stack, RLS rules, and feature-slice conventions in that doc remain in force.

## Product in one line

> Your clients move through your process without logging into anything, and
> you stop chasing them by hand.

A business defines a repeatable process once. Every client, site, or case that
enters it gets a branded, no-login, mobile flow. The product owns the state,
collects the evidence, chases what's outstanding, and shows both sides where
everything stands.

## Positioning

**Shape:** horizontal engine, vertical wedge. The engine (templates → programs
→ units → stages → requirements) stays industry-agnostic; all vertical
vocabulary lives in a thin, swappable layer (template content, copy, demo
data). Nothing about any industry is hard-coded into the schema.

**Wedge (v1 aim):** inspection & compliance service firms — 10–100 field
staff, hundreds of client sites, recurring statutory cycles (fire safety,
lifts, PAT, HVAC, hygiene). Today: spreadsheets, WhatsApp, and a person whose
job is remembering what's due. The buyer's real motivation is how they look to
*their* clients — we let them hand every client a live branded portal instead
of PDFs by email.

**Go-to-market:** build first, sell later (accepted risk). Mitigation: build
what is true across every candidate wedge; keep the wedge swappable.

**Three differentiators:**

1. **The client-facing flow is the product**, not a bolt-on to an internal
   console.
2. **Never the vault.** We keep the record of what was collected, from whom,
   and when; the bytes belong to the customer. No identity documents, ever.
   This is a hard architectural rule (see Evidence), chosen because the
   operator is solo — and it doubles as the answer to every security
   questionnaire.
3. **Recurrence is native.** Processes that repeat on a legal cycle are the
   default case, not a bolted-on cron job. (Built last — slice 11 — but the
   model must never obstruct it.)

**Non-goals (the constraint is the product):** no Gantt/dependencies/resource
levelling, no CRM, no form-builder-as-product, no branching/conditional
workflow engine. **One process, many subjects, linear stages.**

## Decisions log (brainstorm 2026-08-09)

| Decision | Choice | Alternatives rejected |
|---|---|---|
| Where value sits | Client-facing hosted flow | API-first infra (no moat), internal ops tool (crowded), stay vertical |
| Wedge | Compliance inspections; sell to the *service firm*, not the site operator | KYC/legal (data risk), B2B SaaS onboarding (differentiator evaporates), supplier onboarding (reach + medium data risk) |
| Data-risk posture | Own the process, never the vault | Being the document vault (solo liability) |
| GTM | Build first, sell later | Cold outreach now |
| Sequencing | A: prove the thesis (requirements → external flow → portal) | Internal-first, recurrence-first |
| Core noun | `rollout` → `program` | `run`, `cycle`, keep `rollout` |
| Portal access | Long-lived scoped token in URL, read-only | Email-code login, public slug, real accounts |
| Response storage | Typed nullable columns + CHECK | Single jsonb, jsonb + generated columns |

## Surfaces and trust model

Four surfaces over one engine, with **different trust models that must never
blur**:

| Surface | Who | Auth | Can write |
|---|---|---|---|
| Console `/(dashboard)` | org staff | Supabase Auth + RLS by `org_id` | everything in their org |
| Participant flow `/p/[token]` | engineer, installer, site contact | scoped signed token — never an auth user | only outstanding requirements on units in the token's scope |
| Client portal `/portal/[token]` | the customer's customer | long-lived scoped token, read-only | nothing |
| API + webhooks | integrations | API key | **post-v1** |

### Token rules (non-negotiable)

RLS reads `org_id` from the JWT; token surfaces have no JWT, so **RLS cannot
protect them**. Therefore:

- **One chokepoint:** `lib/tokens` is the only module that resolves a token
  (load → check expiry/revocation → return explicit scope). No route or
  action reads `params.token` directly.
- **Writes derive the target from the token, never from the request body.**
  The unit being written comes from the resolved scope; anything the client
  sent is untrusted input validated against that scope.
- **Hashed at rest:** the DB stores SHA-256 of the token; the link is shown
  once at issue time and is unrecoverable. A DB leak leaks no usable links.
- **Entropy ≥128 bits**, base64url, generated server-side.
- **Scope mismatch → 404, never 403** (403 confirms existence).
- **Expired/revoked → "request a new link" page** that notifies the org — a
  person standing on a site needs a way forward, not a dead end.
- **Rate-limit token resolution**; never write tokens to logs;
  `Referrer-Policy: no-referrer` on `/p/*` and `/portal/*` (tokens live in
  URLs); no third-party embeds on those pages.
- Track `last_used_at` for revocation hygiene.

### Data flow, end to end

```
staff creates program from template  →  units imported (CSV)
        ↓
staff issues links                   →  token minted, scoped, hash stored
        ↓
participant opens /p/[token]         →  chokepoint resolves → renders ONLY
                                        outstanding requirements in scope
        ↓
participant submits                  →  server action re-resolves the token,
                                        derives unit_id FROM THE TOKEN
        ↓
requirements satisfied               →  stage completes (derived) → chase
                                        job cancels → portal reflects it
```

## Data model

### Rename (slice 5a — the window closes at first deploy)

`rollouts → programs`, `rollout_stages → program_stages`, plus FKs
(`rollout_id → program_id`, `rollout_stage_id → program_stage_id`), the
`create_rollout` RPC, routes `/rollouts → /programs`,
`features/rollouts/ → features/programs/`, and seed/verify scripts. Deploys
are disabled and the app is local-only, so this is one migration with no
two-release compatibility dance — that is precisely why it happens now.
`template`, `unit`, `stage` generalise fine and stay. RolloutOS remains the
working brand name; renaming the product is a separate, deferred decision.

### New tables (sketch)

```
template_stage_requirements          program_stage_requirements (frozen copy)
  id, template_stage_id, org_id       id, program_stage_id, program_id,
  type, label, required,              org_id, + same fields, written only
  config jsonb, position              inside the create_program RPC

unit_stage_responses
  id, unit_stage_id, program_stage_requirement_id, unit_id, org_id
  type            -- denormalized from the requirement at write time,
                  -- so the one-value rule is a plain CHECK (a CHECK
                  -- cannot reference another table)
  value_text / value_number / value_date / value_bool   -- exactly one
                  -- non-null, matching `type`; all null for type='photo'
  answered_by_participant_id NULL / answered_by_user_id NULL
  created_at, updated_at

evidence            -- metadata only; the row is the compliance record
  id, org_id, unit_id, unit_stage_id, response_id NULL
  provider        -- 'supabase' in v1; BYO providers post-v1
  path/external_ref, filename, mime, size_bytes, checksum_sha256
  uploaded_by_participant_id NULL / uploaded_by_user_id NULL, created_at

participants        -- external people; NEVER auth users
  id, org_id, name, email NULL, phone NULL, created_at

access_tokens
  id, org_id, token_hash UNIQUE, kind ('participant'|'portal')
  participant_id NULL, client_id NULL, program_id NULL, unit_id NULL
  expires_at, revoked_at NULL, last_used_at NULL, created_by, created_at

clients             -- the customer's customer; scopes the portal
  id, org_id, name, created_at
units.client_id     -- nullable FK, added in slice 9
units.assigned_participant_id  -- nullable FK, slice 7 (v1 assignment model)
```

### Requirement types and their storage

v1 types: `text`, `number`, `boolean`, `date`, `choice`, `photo`, `checklist`.

- **Typed nullable columns + CHECK** (decided): every answer is a real
  Postgres type. This matters concretely for recurrence — "every unit whose
  certificate date < now + 30d" must be an indexed date scan, not a jsonb
  cast. Index `value_date`.
- **`choice`** stores its selection in `value_text`; options live in the
  requirement's `config`.
- **`checklist` is editor sugar:** at snapshot time it expands into per-item
  `boolean` requirements (group label preserved in `config`). Keeps the
  typed-column model pure — no jsonb value column exists.
- **`photo` has no scalar:** it is satisfied by ≥1 `evidence` row linked via
  `response_id`. All value columns null.

### Stage completion semantics

`unit_stages.status` (`'pending' | 'done'`) stays, keeps its column-scoped
grant, and becomes **derived by default**: a stage is done when all its
required requirements are satisfied. Staff can override ("engineer confirmed
by phone"). New column `done_source ('requirements'|'override')`, null while
pending — auditors and customers care which one it was.

Blockers/approvals from the original spec remain **post-v1**; the status enum
must not preclude adding them.

### Snapshot invariant (extended, not amended)

Creating a program copies the template's stages **and their requirements**
inside the same RPC (`create_program`). Templates stay freely editable and
deletable; running programs stay frozen. API roles keep select-only grants on
the frozen tables.

### Standing constraints (hard-won, apply to every new table)

- Every domain row carries `org_id`; **index every column an RLS policy
  references**.
- **Every new-table migration ships explicit GRANTs** — newer Supabase images
  drop default ACLs; this already failed CI once on PR #8.
- Test RLS through the client SDK, never the SQL editor. Test token scope
  through the real HTTP surface: *the* core test is that a token minted for
  unit A cannot read or write unit B.
- `service_role` stays server-only.

## Evidence & "never the vault" — v1 scope

v1 collects **structured fields, checklists, and photos** — none sensitive;
photos go to Supabase Storage (bucket policies scoped per org; path
`org_id/program_id/unit_id/...`; size limit enforced). **Arbitrary document
upload is deliberately not in v1** — it arrives post-v1 as BYO storage
(customer connects Drive/SharePoint/S3; bytes stream through; we keep
metadata). The principle is enforced by scope now, by architecture later;
`evidence.provider` exists from day one so nothing is rewritten.

Never touch identity documents; if a process ever needs IDV, call a
specialist (Veriff/Onfido/Sumsub) and store only the verdict + reference.

Photo EXIF/GPS is **kept, and surfaced**: a geotag on an inspection photo is
evidence the engineer was on site — a feature, not a leak. Documented to the
customer.

## Portal (slice 9)

- Route: **`/portal/[token]`** — the token alone is the key; org branding
  (logo, accent color on `orgs`) derives from the token. Vanity slugs and
  custom domains are post-v1. *(Amends the brainstorm's `/portal/[slug]`
  sketch — one key for one door.)*
- **Client-scoped, not program-scoped:** the portal shows one client's units
  **across all programs** — an inspection firm's client wants "all my sites,"
  not one campaign.
- Read-only, long-lived (~12 months), rotatable, revocable. Forwardability is
  accepted for read-only status data.
- Freshness: on-load / periodic revalidate is fine in v1; Realtime is
  post-v1.

## Participant links (slice 7)

Token scope is `(participant, program[, unit])`. With `unit_id` null the flow
lists **all units assigned to that participant** in the program with
outstanding requirements — a 20-site engineer gets one link, not twenty.
Per-unit deep links are the degenerate case. v1 assignment model:
`units.assigned_participant_id` (per-stage assignment is post-v1).

## Roadmap — seven slices, each a shippable PR (★ = thesis-critical)

| # | Slice | Lands | Done when |
|---|---|---|---|
| 5a | Rename | `programs`/`program_stages`, FKs, RPC, routes, feature folder, scripts; one migration | CI green; zero occurrences of the old noun outside migrations |
| 5b | CSV import | Papa Parse import keyed on `units.external_ref` | 500-row import < 10s; re-import is idempotent on `external_ref` |
| 6 | Stage requirements | Requirement tables + snapshot, `unit_stage_responses`, requirement editor, internal fill-in, derived completion + override | A stage completes itself when its requirements are satisfied; override works and records `done_source` |
| 7 ★ | Participants + `/p/[token]` | `participants`, `access_tokens`, `lib/tokens` chokepoint, mobile flow, link issuing | An engineer completes a 5-requirement stage on a phone, no account; scope test passes over HTTP |
| 8 ★ | Photo evidence | `evidence`, Storage upload from the flow, console display | Photo from a phone lands in the unit's record with checksum + attribution |
| 9 ★ | Clients + portal | `clients`, `units.client_id`, org branding, read-only `/portal/[token]` | The demo scene below works end to end |
| 10 | Chasing | Resend + Inngest: send links, reminder cadence, digests, escalation | An unanswered link reminds without human action; submission cancels the chase |
| 11 | Recurrence | Due dates, expiry, re-arm, lapse detection | A completed unit re-enters the pipeline when its certificate nears expiry |

Slices 5–9 before 10–11 is deliberate: chasing automates links that must
exist; recurrence automates a loop that should be walked manually first.
CSV import is demoted from headline feature to utility — needed so the matrix
has 200 rows to show, nothing more.

**Post-v1:** public API + webhooks, BYO-storage document upload, per-stage
assignment, blockers/approvals, SMS links, Realtime portal, map view, Stripe
billing, multi-language, custom domains.

## The target demo scene (what "v1 done" means)

> A 200-site fire safety program. An engineer opens a link on their phone at
> a site — no account, no app — and completes the inspection in under a
> minute: checklist, meter reading, expiry date, two photos. The client's
> branded portal reflects it before they've driven away.

If a slice doesn't move that scene closer, it isn't v1. This sentence is what
stops slice 6 becoming a form builder and slice 9 becoming a dashboard
designer.

**Measurable success criteria:**

- Participant flow completable in < 60s on a mid-range phone.
- A token scoped to unit A cannot read or write unit B — asserted through the
  HTTP surface in integration tests.
- 500-row CSV import < 10s; matrix stays smooth at 200 units × 8 stages
  (virtualized).
- Portal reflects a submission on next load, < 5s after write.
- A dumped database contains no usable participant or portal links.

## Open questions (deliberately deferred)

1. **Recurrence model** — program-level schedule vs requirement-expiry
   driven. Gets its own brainstorm before slice 11.
2. **Pricing meter** — per active unit/month vs per run. Irrelevant until
   selling; per-run alignment (Mollie-style) is the intent.
3. **Product name** — RolloutOS vs the new positioning. Brand decision, not
   a code one; noun rename already de-risks the code side.
4. **Chasing cadence defaults** — and a "stop reminding me" affordance for
   participants; decide in slice 10.
