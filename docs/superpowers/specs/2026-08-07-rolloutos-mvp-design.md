# RolloutOS — MVP Tech Stack & Scaffold Design

**Date:** 2026-08-07
**Status:** Approved (stack + scope + structure). Scaffold complete.

## Product in one line

B2B SaaS for service providers who execute one repeatable workflow across many
similar physical units (stores, vehicles, sites, devices). One **rollout**
holds many **units**, each independently moving through the same **stage**
lifecycle. Differentiators: the progress matrix, external magic-link field
workflows, and a white-label client portal.

## Team & platform assumptions

- Solo / small team, strongest in **TypeScript**.
- **Managed BaaS** (Supabase) over roll-your-own, to reach MVP fast.
- Responsive web only; no native app in v1.

## Tech stack (verified current as of 2026-08)

| Concern | Choice | Version at scaffold |
|---|---|---|
| Language | TypeScript | 5.x |
| Framework | Next.js App Router (Server Components default) | 16.3.0 |
| UI | Tailwind CSS v4 + shadcn/ui (Base UI primitives, `base-nova` preset) | tailwind v4 |
| Data platform | Supabase (Postgres + Auth + Storage + Realtime + RLS) | — |
| ORM | Drizzle (`drizzle-orm` + `postgres` driver) | latest |
| Validation | Zod (shared client/server) | latest |
| Forms | React Hook Form + `@hookform/resolvers` | latest |
| Tables/matrix | TanStack Table + TanStack Virtual + TanStack Query | latest |
| CSV import | Papa Parse | latest |
| Hosting (planned) | Vercel (app, incl. multi-tenant/wildcard domains) + Supabase (data) | — |

**Deferred libraries (added in their phase, not at scaffold):** Inngest
(jobs/human-in-the-loop workflows), Resend + React Email (email), Twilio (SMS),
MapLibre GL (maps), Stripe (billing).

### Decisions that were genuinely open

- **Drizzle over Prisma** — deeply relational model + migration discipline +
  serverless cold starts. (Prisma 7 is also viable; not chosen.)
- **Inngest over Trigger.dev** — RolloutOS is heavily human-in-the-loop
  (approvals, "wait for installer", blocker escalation); Inngest `waitForEvent`
  models durable waits directly. Revisit if self-hosting/lock-in becomes a
  priority.
- **shadcn Base UI (`base-nova`)** — shadcn's current default; supersedes the
  older Radix preset. Fully current and accessible.

## Non-negotiable architectural rules

### Multi-tenancy via RLS (verified best practice)
- Every domain row carries `org_id`.
- **Index every column an RLS policy references** (top RLS perf killer).
- Put `org_id` + role in the **JWT claim** (`app_metadata`) so policies read
  from the token, not a per-row lookup.
- **`service_role` key is server-only** and bypasses RLS — never on the client.
- Test policies through the client SDK, not the SQL editor (editor bypasses RLS).

### Two kinds of magic link (deliberately separate)
1. **Internal users** → Supabase Auth (email link / password).
2. **External participants** (installers, store managers, customers) → a custom
   scoped **token table + signed links**, resolved server-side at `/p/[token]`.
   They never become auth users — the product must never charge or force
   accounts on external collaborators.

### Feature-sliced structure
`app/` stays thin (routing + composition); domain logic lives in `features/<name>/`
(`queries.ts`, `actions.ts`, `schema.ts`, `components/`). Every Server Action
validates input with a Zod schema.

## MVP scope (phased build order — all still "v1")

- **Phase 0 — Foundation:** Next.js + Supabase + org/tenant model + auth + RLS. ✅ scaffolded
- **Phase 1 — Model the work:** Template builder (stages + fields + checklists),
  Rollout creation, CSV import → Units.
- **Phase 2 — Execute & track:** Progress matrix (virtualized), unit detail,
  stage advancement, file/photo uploads, checklists.
- **Phase 3 — External collaboration:** Magic-link installer flow (start →
  before photos → checklist → after photos → signature → complete), blockers,
  approvals.
- **Phase 4 — Visibility:** Email notifications (Resend/Inngest), basic
  branded client portal.

**Deferred within v1 (after the above works):** map view, full rollout-wave
dashboards, SMS links, Stripe billing.

**Explicitly out of v1:** native app, CRM/accounting/Gantt, workflow-automation
engine, AI.

## Folder structure

```
src/
├── app/
│   ├── (auth)/login/
│   ├── (dashboard)/{rollouts,templates,settings}/
│   ├── portal/[portalSlug]/        # white-label client portal
│   ├── p/[token]/                  # external participant magic-link entry
│   └── api/                        # inngest + webhooks (later)
├── features/                       # domain slices (see features/README.md)
│   ├── templates/ rollouts/ units/ stages/
│   ├── evidence/ approvals/ blockers/
│   └── participants/ import/ portal/
├── db/{schema,migrations,rls}/     # Drizzle tables, migrations, RLS SQL
├── lib/{supabase,auth,email,sms,storage,utils}/
├── components/{ui,shared}/         # ui = shadcn
├── inngest/                        # job/workflow definitions
├── env.ts                          # Zod-validated env
└── proxy.ts                        # Next 16 proxy (auth session refresh)
```

## Scaffold state (done)

- `create-next-app` (TS, Tailwind v4, App Router, `src/`, Turbopack, `@/*`).
- shadcn/ui initialized (`base-nova`); `button` + `lib/utils` present.
- Deps: drizzle-orm, postgres, @supabase/supabase-js, @supabase/ssr, zod,
  react-hook-form, @hookform/resolvers, @tanstack/{react-table,react-virtual,react-query},
  papaparse; dev: drizzle-kit, @types/papaparse, tsx.
- Infra wired: `db/index.ts`, `drizzle.config.ts`, starter `orgs`/`org_members`
  schema (with RLS-column indexes), Supabase server/client/proxy helpers,
  `env.ts`, `.env.example`.
- npm scripts: `db:generate`, `db:migrate`, `db:push`, `db:studio`.
- Verified: `tsc --noEmit` clean; `next build` succeeds; proxy convention active.

## Open items before Phase 1

1. Create the Supabase project; populate `.env.local` from `.env.example`.
2. Tighten `env.ts` server vars to required once credentials exist.
3. First implementation plan: full domain schema + RLS policies (Phase 0/1).
