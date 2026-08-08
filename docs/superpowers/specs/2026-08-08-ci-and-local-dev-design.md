# CI Pipeline & Local Development Experience

**Date:** 2026-08-08
**Status:** Approved, ready for planning

## Problem

Two related gaps.

**Local development is not self-explanatory.** A fresh clone runs `npm install &&
npm run dev` and gets an app pointed at nothing. Three separate facts have to be
known but are written down nowhere:

1. Drizzle owns migrations in `src/db/migrations/`. The Supabase CLI only reads
   `supabase/migrations/`, which does not exist. `supabase start` therefore
   produces an **empty database**, and `npm run db:migrate` must be run by hand
   afterward.
2. `.env.local` must be populated with keys that `supabase start` prints to
   stdout. Nothing captures them.
3. `supabase/config.toml` sets `db.seed.sql_paths = ["./seed.sql"]`, but
   `supabase/seed.sql` is absent.

There is also an ordering constraint that makes the obvious fix wrong:
`supabase db reset` runs `seed.sql` *before* Drizzle has created any tables, so
SQL seeding cannot reference application schema. Seeding must happen after
`db:migrate`.

**There is no CI.** No `.github/` directory. Nothing verifies lint, types,
tests, the production build, or migration integrity. No git remote is configured
yet either, so workflows will be written against a repository that does not exist
until the user creates it.

## Goals

- `npm run dev` on a fresh clone brings up everything needed, or fails with an
  instruction the developer can act on.
- Every pull request is verified: lint, types, tests, production build, and
  database migrations.
- Merges to `main` migrate the production database *before* the new code serves
  traffic.

## Non-goals

- Prettier. Adding it reformats the entire tree to gain a formatting-check job
  that carries no current value. Deferred.
- A production Dockerfile. Deployment is Vercel, which does not consume one.
  Docker's role stays exactly what it already is: the runtime beneath
  `supabase start`.
- End-to-end / browser tests. No harness exists; out of scope.
- Preview-environment databases. Previews point at the shared staging database.

## Environment baseline

| Item | Value |
|---|---|
| Node | 24 (pinned via `.nvmrc`) |
| Postgres | 17 (`supabase/config.toml` `db.major_version`) |
| Supabase API | `http://127.0.0.1:54351` |
| Supabase DB | `postgresql://postgres:postgres@127.0.0.1:54352/postgres` |
| Studio | `http://127.0.0.1:54353` |
| Mailpit | `http://127.0.0.1:54354` |

The `+30` port offset is deliberate and pre-existing; it avoids collision with a
default Supabase install.

---

## Part 1 — Local development

### `scripts/dev-preflight.ts`

One idempotent script, run as npm's `predev` hook and also exposed as
`npm run setup`. It is a no-op costing roughly a second when everything is
already up. Steps, in order, each failing with a specific remedy:

1. **Docker daemon reachable?** `docker info`. On failure: "Docker isn't
   running. Start Docker Desktop and re-run `npm run dev`."
2. **Supabase up?** `supabase status`. If not, `supabase start`. First run pulls
   images and takes several minutes — the script says so before it blocks.
3. **`.env.local` present and populated?** Create from `.env.example` if
   missing. Read `supabase status -o env` and fill *only blank* keys:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`. Never overwrite a non-empty
   value — a developer pointed at a remote project must not be silently
   redirected to localhost.
4. **Migrations current?** `drizzle-kit migrate`. Idempotent; a no-op when
   nothing is pending.

Escape hatch: `SKIP_PREFLIGHT=1 npm run dev` exits at step 0. This matters for
offline UI work and for anyone who deliberately runs against a remote Supabase
project.

The script is the single source of truth for "what does this app need to run."
Its checks are independent and individually testable; each returns a
pass/fail plus a remedy string rather than calling `process.exit` itself, so the
runner owns all output formatting.

### `scripts/seed.ts`

Demo data via the Supabase admin API (service-role key), not SQL — the schema's
`orgs` / `org_members` hang off `auth.users`, which only the Auth API can
populate correctly. Creates one confirmed demo user and one org with that user
as a member. Idempotent: existing demo rows are reused, not duplicated.

`supabase/seed.sql` is created as a comment-only no-op that points at
`scripts/seed.ts` and explains the ordering constraint. This silences the
dangling `sql_paths` reference without pretending SQL seeding is viable.

### npm scripts

| Script | Definition | Purpose |
|---|---|---|
| `setup` | `tsx scripts/dev-preflight.ts` | First-clone bootstrap |
| `predev` | `tsx scripts/dev-preflight.ts` | Auto-runs before `dev` |
| `dev` | `next dev` | Unchanged |
| `typecheck` | `tsc --noEmit` | New |
| `verify` | `npm run lint && npm run typecheck && npm run test` | Run what CI runs |
| `db:reset` | `supabase db reset && npm run db:migrate && npm run db:seed` | Clean slate |
| `db:seed` | `tsx scripts/seed.ts` | Demo data |
| `supabase:start` / `:stop` / `:status` | CLI passthroughs | Discoverability |

`db:generate`, `db:migrate`, `db:push`, `db:studio`, `lint`, `test`,
`test:watch`, `build`, `start` are unchanged.

### `.nvmrc`

Contains `24`. Consumed locally by nvm/fnm and in CI by
`actions/setup-node`'s `node-version-file`, so the two cannot drift.

### README

The `Getting started` section is rewritten to a three-command quickstart, and
gains a ports table and a troubleshooting table (Docker not running, port
already in use, migrations out of sync, stale containers). The scripts table is
updated to match the list above.

---

## Part 2 — CI

### `.github/actions/setup/action.yml`

Composite action: `actions/checkout` → `actions/setup-node`
(`node-version-file: .nvmrc`, `cache: npm`) → `npm ci`. Every job uses it, so
the Node version and install strategy are defined once.

### `.github/workflows/ci.yml`

Triggers: `pull_request`, and `push` to `main`.
Workflow-level `permissions: contents: read`.
`concurrency: group: ci-${{ github.ref }}, cancel-in-progress: true`.

| Job | Command | Notes |
|---|---|---|
| `lint` | `npm run lint` | |
| `typecheck` | `npm run typecheck` | |
| `test` | `npm run test` | `vitest run` |
| `build` | `npm run build` | Caches `.next/cache` |
| `db` | see below | Migration integrity |
| `ci` | aggregator | The single required status |

**`build`.** Restores `.next/cache` via `actions/cache`, keyed on the lockfile
hash plus a hash of `src/**`, per the Next.js CI build-caching guide. Supplies
placeholder `NEXT_PUBLIC_*` values so `src/env.ts` validation passes; these are
inlined into the bundle but the artifact is discarded, so the values are inert.

**`db`.** A plain `postgres:17` service container **cannot** run these
migrations: `0001_foundation_rls.sql` calls `auth.uid()`, and the `auth` schema
only exists once GoTrue has migrated. The job therefore uses
`supabase/setup-cli` and starts a trimmed local stack:

```
supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor
```

This keeps `db` and `auth` and drops roughly 60 seconds of unused services. It
then:

1. Runs `drizzle-kit migrate` against `127.0.0.1:54352` — proves migrations
   apply cleanly to an empty database.
2. Runs `drizzle-kit generate`, then `git diff --exit-code src/db/migrations`.
   A non-empty diff means the Drizzle schema and the committed migrations have
   **drifted** — someone edited `src/db/schema/` without generating a migration.
   This is the highest-value check in the pipeline and the one most likely to
   catch a real bug.

**`ci`.** `needs: [lint, typecheck, test, build, db]`, `if: always()`, and fails
unless every dependency reports `success`. Branch protection requires this one
status, so adding a job later does not require touching the protection rules.

### `.github/dependabot.yml`

Weekly updates for `npm` and `github-actions`.

---

## Part 3 — Deploy

Vercel's Git integration deploys the instant a merge lands, which races the
migration and can serve new code against an old schema. So **Vercel's automatic
Git deployments are turned off** and GitHub Actions drives the deploy.

### `.github/workflows/deploy.yml`

Trigger: `workflow_run` on `ci.yml` `completed`, filtered to `main` and guarded
by `if: github.event.workflow_run.conclusion == 'success'`; plus
`workflow_dispatch` for manual re-runs. Using `workflow_run` rather than `push`
means CI success is a structural precondition of the workflow starting, not a
step inside it that could be skipped.
`concurrency: group: deploy-production, cancel-in-progress: false` — deploys
queue rather than overlap, because two concurrent `drizzle-kit migrate` runs
against one database is a corruption risk.
Uses GitHub Environment `production`, which is where the manual-approval gate is
configured if wanted.

Sequential steps in one job (they share state and must not interleave):

1. Check out `github.event.workflow_run.head_sha` — `workflow_run` defaults to
   the tip of `main`, which may have moved past the commit CI actually verified.
2. `drizzle-kit migrate` against the production `DATABASE_URL`.
3. `vercel pull --environment=production`
4. `vercel build --prod`
5. `vercel deploy --prebuilt --prod`

Migration precedes deploy, so the schema is always at or ahead of the code. This
requires migrations to be **backward compatible** with the currently-deployed
code for the window between steps 2 and 5 — additive changes only, with
destructive changes split across two releases. This is documented in the README.

### Required secrets

Under the `production` environment: `DATABASE_URL` (direct connection, port
5432 — not the pooler, which cannot run DDL reliably), `VERCEL_TOKEN`,
`VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.

### Preview deploys

Deferred. Re-enabling Vercel's Git integration for non-`main` branches only is
the likely answer, but it needs a staging database decision first.

---

## Risks

- **No git remote exists.** Workflows cannot be validated by running them until
  the user creates the GitHub repository and pushes. They will be reviewed by
  reading, and the underlying commands verified locally where possible.
- **`supabase start` in CI is slow** (~60–90s even trimmed) and depends on
  Docker Hub availability. It runs as its own job so it does not block the fast
  feedback from `lint` / `typecheck` / `test`.
- **The preflight script auto-starting Docker containers is opinionated.**
  `SKIP_PREFLIGHT=1` is the release valve, and it is documented in the README
  next to the `dev` script rather than buried.

## Verification

- `npm run setup` succeeds from a clean state (containers down, `.env.local`
  deleted) and leaves a working app.
- `npm run setup` run twice in a row is a no-op the second time.
- `npm run db:reset` yields a migrated, seeded database.
- `npm run verify` passes.
- Preflight failure paths produce their intended message: Docker stopped, and
  `.env.local` containing a non-Supabase `DATABASE_URL` (must not be
  overwritten).
- Workflow YAML parses (`actionlint`).
- The drift check fails as designed when `src/db/schema/` is edited without a
  generated migration.
