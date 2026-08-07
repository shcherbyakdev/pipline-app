# RolloutOS

B2B SaaS for service providers who run one repeatable workflow across many
similar physical units (stores, vehicles, sites, devices). One **rollout** holds
many **units**, each moving independently through the same **stage** lifecycle.

> One workflow. Hundreds of locations. Zero spreadsheet chaos.

## Stack

Next.js 16 (App Router) · React 19 · Tailwind v4 · shadcn/ui (Base UI) ·
Supabase (Postgres/Auth/Storage/RLS) · Drizzle ORM · Zod · TanStack
Table/Virtual/Query.

## Getting started

```bash
cp .env.example .env.local   # then fill in Supabase + DATABASE_URL
npm install
npm run dev                  # http://localhost:3000
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Dev server (Turbopack) |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate a Drizzle migration from schema |
| `npm run db:migrate` | Apply migrations |
| `npm run db:push` | Push schema directly (dev) |
| `npm run db:studio` | Drizzle Studio |

## Layout

- `src/app/` — routing + composition only (kept thin).
- `src/features/<name>/` — domain slices (`queries.ts`, `actions.ts`,
  `schema.ts`, `components/`). See `src/features/README.md`.
- `src/db/` — Drizzle schema, migrations, RLS SQL.
- `src/lib/` — Supabase clients, auth, email, sms, storage helpers.

Design & scope: `docs/superpowers/specs/2026-08-07-rolloutos-mvp-design.md`.
