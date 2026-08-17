# Booklo

B2B SaaS for businesses that run one repeatable process across many similar
subjects — client sites, stores, vehicles, cases. One **program** holds many
**units**, each moving independently through the same **stage** lifecycle,
with a branded no-login flow for the people who do the work.

> One process. Hundreds of clients. Zero spreadsheet chaos.

## Stack

Next.js 16 (App Router) · React 19 · Tailwind v4 · shadcn/ui (Base UI) ·
Supabase (Postgres/Auth/Storage/RLS) · Drizzle ORM · Zod · TanStack
Table/Virtual/Query.

## Getting started

**Prerequisites:** [Docker Desktop](https://docs.docker.com/desktop/) running,
the [Supabase CLI](https://supabase.com/docs/guides/cli), and Node 24
(`nvm use` picks it up from `.nvmrc`).

```bash
npm install
npm run dev
```

That's it. `npm run dev` runs a preflight that starts Docker's Supabase stack,
writes the local credentials into `.env.local`, and applies pending migrations
before booting Next.js. Next prints the actual URL it's listening on — it'll
use the next free port (e.g. 3001) if 3000 is already taken.

Seed a demo account with `npm run db:reset`, then sign in as
`demo@rolloutos.local` / `Password123!`.

### Local services

| Service | URL |
|---|---|
| App | http://localhost:3000 |
| Supabase API | http://127.0.0.1:54351 |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54352/postgres` |
| Supabase Studio | http://127.0.0.1:54353 |
| Mailpit (outbound email) | http://127.0.0.1:54354 |

Ports are offset by +30 from the Supabase defaults so a second Supabase project
can run alongside this one.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Preflight, then the dev server |
| `npm run setup` | Preflight only — Docker, Supabase, `.env.local`, migrations |
| `npm run verify` | Fast local subset: lint + typecheck + test |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest (`test:watch` for watch mode) |
| `npm run db:reset` | Wipe, re-migrate, and re-seed the local database |
| `npm run db:generate` | Generate a Drizzle migration from the schema |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:push` | Push schema directly, bypassing migrations — don't use; CI's drift check will fail if schema and migrations disagree |
| `npm run db:seed` | Demo org + user (idempotent) |
| `npm run db:studio` | Drizzle Studio |
| `npm run supabase:start` / `:stop` / `:status` | Manage the local stack |

CI additionally runs a production build and the migration/drift job (see
CI/CD below), so a green `verify` doesn't guarantee CI will pass.

Skip the preflight with `SKIP_PREFLIGHT=1 npm run dev` — useful when working
offline or pointing at a remote Supabase project.

### Troubleshooting

| Symptom | Fix |
|---|---|
| `Docker isn't running` | Start Docker Desktop and wait for it to settle |
| Port 54351–54354 already in use | `npm run supabase:stop`, then `npm run dev` |
| Login fails / app sees no data | `npm run db:reset` |
| `.env.local` has the wrong values | Delete it and run `npm run setup` |
| Containers stuck after a crash | `supabase stop --no-backup && npm run dev` |
| `db:seed` refuses to run (`refusing to seed non-local host`) | Expected — it only seeds a loopback Supabase URL, to keep the fixed demo login (`demo@rolloutos.local` / `Password123!`) off remote projects. Seeding a remote project on purpose? Set `ALLOW_REMOTE_SEED=1`. |

## Migrations

Drizzle owns migrations; they live in `src/db/migrations/`, **not**
`supabase/migrations/`. Change `src/db/schema/`, then:

```bash
npm run db:generate   # writes a new migration
npm run db:migrate    # applies it locally
```

CI fails if the schema and the committed migrations have drifted.

When deploys are enabled, production migrations run automatically from
`.github/workflows/deploy.yml` *before* the new build is promoted — so a
migration must be backward compatible with the currently-deployed code. Make
additive changes only; split destructive changes (dropping a column, renaming)
across two releases. (Deploys are currently disabled — see CI/CD below.)

## CI/CD

Every PR runs lint, typecheck, tests, a production build, and a database job
that applies migrations to an empty database and checks for schema drift.
Require the single `ci` status in branch protection.

**Deploys are currently disabled** — this project runs local-only for now. The
`Deploy` workflow exists but its automatic trigger is commented out in
`.github/workflows/deploy.yml`; the re-enable steps are documented at the top
of that file. When enabled, it migrates the production database and then builds
and promotes to Vercel, gated on a green CI run. (Vercel's own Git auto-deploy
must stay **disabled** so the two never race, and the `production` GitHub
Environment needs `DATABASE_URL` — direct connection, port 5432 —
`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.)

## Layout

- `src/app/` — routing + composition only (kept thin).
- `src/features/<name>/` — domain slices (`queries.ts`, `actions.ts`,
  `schema.ts`, `components/`). See `src/features/README.md`.
- `src/db/` — Drizzle schema, migrations, RLS SQL.
- `src/lib/` — Supabase clients, auth, email, sms, storage helpers.

Design & scope: `docs/superpowers/specs/2026-08-09-client-flow-vision-and-roadmap-design.md`
(stack details: `docs/superpowers/specs/2026-08-07-rolloutos-mvp-design.md`).
