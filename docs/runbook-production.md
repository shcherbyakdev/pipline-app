# Production runbook

Operator procedures for `https://booklo.co`. Every command below is meant to
be copy-pasted; none of them contain a real secret — fill in the
placeholders from your own credential store first.

This document assumes the production Supabase project, Vercel project, and
Cloudflare Worker already exist (spec `2026-08-19-launch-infrastructure` §11
cutover). It does not walk through creating them.

---

## 0. How a deploy happens

Every merge to `main` deploys itself: CI runs, and when it is green
`.github/workflows/deploy.yml` (a) builds the verified commit **on Vercel**
without promoting it (`vercel deploy --prod --skip-domain`), (b) runs
`drizzle-kit migrate` against the session pooler, (c) promotes that build
(`vercel promote`), and (d) smoke-tests the origin in the repository
variable `APP_URL`. A manual run is **Actions → Deploy → Run workflow** on
`main`. The Vercel project is deliberately **not** connected to Git — a
Git-triggered build would race step (b).

Why the build is not done on the runner (the spec's original `vercel pull` →
`vercel build` → `--prebuilt` flow): this Vercel team stores every
environment variable as *Sensitive*, which is write-only — `vercel pull`
returns placeholders, and `src/env.ts` fails validation at module load. The
cloud build sees the real values. The ordering guarantee is unchanged:
build → migrate → promote, so a failed build leaves production untouched and
the schema is always at or ahead of the running code.

Secrets/variables the workflow needs: `VERCEL_TOKEN`, `VERCEL_ORG_ID`,
`VERCEL_PROJECT_ID`, `DATABASE_URL` (session pooler) and the variable
`APP_URL` (`https://booklo-five.vercel.app` during the test phase;
`https://booklo.co` at launch, together with the `site_url` flip in
`supabase/config.toml`).

---

## 1. Run the readiness check

`scripts/setup-production.ts` is the gate at every stage of cutover and the
first thing to run whenever something in production looks wrong. It only
checks failures that are **silent** — a 500 page or a wrong region will tell
you directly, so it does not bother re-checking those.

It also needs `psql` on your `PATH`: the migration-count check shells out to
it (`brew install libpq` and add its `bin` to `PATH` on macOS;
`postgresql-client` on Debian/Ubuntu). Without it the check fails with an
`ENOENT` spawn error, not a database error.

Export the four credentials it needs, then run it:

```bash
export SUPABASE_ACCESS_TOKEN='<supabase management api token>'
export RESEND_API_KEY='<resend api key>'
export SCHEDULING_DRAIN_SECRET='<drain shared secret>'
export DATABASE_URL='<session pooler, :5432>'

PROD_PROJECT_REF=<project-ref> npx tsx scripts/setup-production.ts
```

It prints `PASS`/`FAIL` for each of: credentials present, `supabase/config.toml`
carrying the production ref, remote `site_url`, Resend domain verification,
migration count, and drain auth (valid token → 200, bad token → 401). It
exits non-zero if anything failed. It is safe to re-run — it reports state,
it does not assume a fresh start.

One caveat: the drain check's "valid Bearer" call runs a **real** reminder
drain tick. Harmless, but not a dry run — don't run this repeatedly against
production for no reason.

---

## 2. Apply Supabase config

`supabase/config.toml` carries a `[remotes.production]` block (auth
`site_url`, redirect URLs, rate limits, SMTP). Pushing it requires the real
Resend API key, since `pass = "env(RESEND_API_KEY)"` is resolved from your
shell at push time:

```bash
RESEND_API_KEY='<resend api key>' supabase config push --project-ref <project-ref> --yes
```

**Confirm `Loading config override` appears in the output.** If the
`project_id` in `supabase/config.toml`'s `[remotes.production]` block does
not exactly match `--project-ref`, the CLI silently skips the whole override
block and pushes the **base** (local-dev) config instead — `localhost`
`site_url`, no SMTP, `email_sent = 2` — with a zero exit code and no error.
`scripts/setup-production.ts`'s `checkRemoteRef` catches this ahead of time,
but the push output is the last line of defense; do not skip reading it.

Then **review the full diff Supabase shows before confirming**, not just the
auth section — `config push` covers API, database, and storage settings too,
not only `[auth]`. A stray local-only value (a permissive CORS setting, a
storage file-size limit) can ride along in the same push.

---

## 3. Migrate production

```bash
ALLOW_REMOTE_DB=1 DATABASE_URL='<session pooler, :5432>' npx drizzle-kit migrate
```

Both variables, inline on the command itself:

- `DATABASE_URL` — `drizzle.config.ts` calls `loadEnvFile(".env.local")`
  before reading `process.env.DATABASE_URL`, so a bare `npx drizzle-kit
  migrate` targets your **local** Supabase stack, not production —
  silently, since your local database happily accepts the same migrations.
  An exported shell variable takes precedence over the value `loadEnvFile`
  loads from the file, which is why setting it inline works.
- `ALLOW_REMOTE_DB=1` — `drizzle.config.ts` refuses any `DATABASE_URL` whose
  host is not loopback (`127.0.0.1` / `localhost` / `::1`) unless this is
  set. That is the guard against the opposite mistake: a production URL
  left exported in your shell from §1 or §4, and then a bare `drizzle-kit
  migrate` (or `push`, or `drop`) run for local work reaching the live
  database. Set it inline, never in a shell profile; `deploy.yml` sets it on
  its migrate step and nowhere else.

Use the **session pooler** (`:5432`), not the transaction pooler (`:6543`)
and not the direct connection. This project uses two different
`DATABASE_URL` values on purpose:

| Context | Pooler | Port | Why |
|---|---|---|---|
| GitHub Actions (`deploy.yml`, this step) | session | `5432` | DDL needs a stable session; GitHub runners are IPv4-only, so the direct connection (IPv6-only) is not an option either. |
| Vercel runtime | transaction | `6543` | Serverless functions want short-lived pooled connections, not DDL. |

Running a migration against the transaction pooler is a common way to get a
confusing, intermittent DDL failure — if you see one, check which pooler URL
you used first.

After migrating, `scripts/setup-production.ts`'s `checkMigrations` confirms
the row count in `drizzle.__drizzle_migrations` matches the entry count in
`src/db/migrations/meta/_journal.json`.

---

## 4. Restore a backup

Supabase Free has no restorable backups — the daily encrypted dump
(`.github/workflows/backup.yml`) is the **only** restore path, with a
worst-case data loss window of 24 hours.

Note: `supabase/config.toml`'s `[remotes.production]` block carries the real
production project ref (substituted at cutover step 2). If you ever replace it
with a placeholder again — for a second environment, say — keep the value
format-valid (20 lowercase letters). The config decoder validates it on every
command, so an invalid-format value breaks the ordinary `supabase` CLI calls
this restore procedure needs, not just remote ones.

Each run uploads **two** encrypted files: `booklo-YYYYMMDD-schema.sql.enc`
(a `pg_dump --schema-only` of `public`/`auth`/`storage`/`drizzle`) and
`booklo-YYYYMMDD-data.sql.enc` (`--data-only --use-copy`, the same four
schemas). A bare `supabase db dump` is schema-only — it *looks* like a backup
and restores an empty database — which is why the job takes both and fails
if the data dump contains no `COPY` block. **The data file is the backup.**
The schema file is the reference for what the database looked like, and the
fallback for a target where the migration chain below cannot be applied.

1. Download the artifact (`booklo-backup-<run-id>`) from the `Backup` workflow
   run in GitHub Actions and unzip it to get the two `.sql.enc` files.

2. Decrypt them. This must match `backup.yml`'s encryption exactly — cipher
   `aes-256-cbc`, key derivation `-pbkdf2`, 600000 iterations — or `openssl`
   will fail or (worse) produce garbage:

   ```bash
   for part in schema data; do
     openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
       -in booklo-YYYYMMDD-$part.sql.enc -out $part.sql \
       -pass env:BACKUP_PASSPHRASE
   done
   ```

   `BACKUP_PASSPHRASE` is the same GitHub Actions secret the backup job
   encrypts with — pull it from wherever your credential store keeps repo
   secrets, export it locally, and unset it from your shell when you're done.

3. Recreate the schema by applying migrations, **at the commit the backup
   was taken from** (the `Backup` run's commit SHA, on its summary page), so
   the tables match the rows about to land in them:

   ```bash
   git checkout <sha of the backup run>
   ALLOW_REMOTE_DB=1 DATABASE_URL='<target, session pooler :5432>' npx drizzle-kit migrate
   ```

   This is the full migration chain, not `schema.sql`: a Supabase project
   already owns the `auth`/`storage` DDL, and `drizzle-kit migrate` owns
   `public`/`drizzle`. Applying `schema.sql` on top would fail on the
   `auth`/`storage` objects (owned by `supabase_auth_admin` /
   `supabase_storage_admin`, roles that exist only inside a Supabase-provisioned
   project) and fight the migration journal for `public`.

4. Load the data. `drizzle-kit migrate` just wrote its own rows into
   `drizzle.__drizzle_migrations`, and `data.sql` carries the backup's copy of
   that same journal — clear the fresh rows first, or that `COPY` conflicts
   and aborts the transaction:

   ```bash
   psql '<target DATABASE_URL>' -c 'truncate drizzle.__drizzle_migrations'
   psql '<target DATABASE_URL>' --single-transaction -v ON_ERROR_STOP=1 -f data.sql
   ```

   `data.sql` opens with `SET session_replication_role = replica` (triggers
   and FK checks off for the load) and is ordered by dependency, so it applies
   in one transaction and either lands whole or not at all.

5. If the backup predates the code you intend to run, check out `main` and
   migrate forward with the §3 command; the restored journal is exactly what
   makes that apply only the newer migrations rather than the full chain.

**Why `drizzle` is in the dump at all:** without its `__drizzle_migrations`
rows, step 5 would re-run the full migration chain against already-populated
tables. **Why `auth` is:** without it, user accounts are unrestorable — the
data dump carries `auth.users`, `auth.identities`, sessions and refresh
tokens; Supabase's own `auth.schema_migrations` / `storage.migrations`
bookkeeping is excluded by the CLI, so those rows never conflict with the
target project's.

---

## 5. Un-pause a paused project

Supabase Free pauses a project after roughly 7 days of inactivity. Resume it
from the Supabase dashboard: **Project Settings → General → Restore project**
(or the banner shown on the project overview page).

**Before you conclude Supabase paused the project on its own, check
[healthchecks.io](https://healthchecks.io) first.** The pause is almost
always a downstream symptom, not the root cause: the Cloudflare Worker
(`workers/cron/`) is what generates the database traffic keeping the project
awake, by hitting `/api/scheduling/drain` every 15 minutes. If the Worker's
cron died (a bad deploy, an expired secret, a Cloudflare-side issue), drain
traffic stops, the healthcheck goes quiet, and the project pauses roughly a
week later as a delayed side effect.

So: check the healthcheck's last-ping time first. If it's stale, the Worker
is the actual problem — redeploy it (`wrangler deploy` from `workers/cron/`)
and confirm pings resume — before assuming a Supabase-side fault and just
un-pausing and moving on. Un-pausing without fixing a dead Worker just buys
you another ~7 days before the same pause recurs.

---

## 6. Roll back a deploy

Promote the previous deployment from the Vercel dashboard (**Deployments →
select the prior one → Promote to Production**), or via CLI:

```bash
vercel rollback --token=<vercel token>
```

**Hobby plan caveat:** `vercel rollback` can only promote the **immediately
previous** production deployment. Going further back returns `To roll back
further than the previous production deployment, upgrade to pro` — for
anything older than one deployment, use the dashboard's **Deployments** list
and **Promote to Production** on the specific deployment you want instead.

**Migrations are not rolled back by this.** `deploy.yml` runs
`drizzle-kit migrate` **before** promoting the new build, specifically so the
schema is always at or ahead of the code that's running. That means after a
code rollback, the previous (older) code is now running against the
**newer** schema state — rolling back the deploy does not undo the
migration that shipped with it.

Practically: only roll back a deploy whose migrations are backward
compatible with the version you're rolling back to (this is also why
migrations in this repo are written to be backward compatible in the first
place — see `deploy.yml`'s comment on the migrate step). If the deploy you're
rolling back away from included a breaking schema change, a plain Vercel
rollback is not enough by itself; you need a compensating migration too, not
a schema rollback (there isn't a supported one).

---

## 7. Rotate a secret

`SCHEDULING_DRAIN_SECRET` (or any other shared secret used by more than one
runtime) lives in **three** places that must be rotated together:

1. **Vercel** — project environment variables (`SCHEDULING_DRAIN_SECRET`,
   Production scope). Update via the dashboard or:
   ```bash
   vercel env rm SCHEDULING_DRAIN_SECRET production
   vercel env add SCHEDULING_DRAIN_SECRET production
   ```
2. **Cloudflare Worker secret** (`workers/cron/`) — the Worker sends this
   value as the drain request's Bearer token:
   ```bash
   cd workers/cron && wrangler secret put SCHEDULING_DRAIN_SECRET
   ```
3. **The operator shell** — anywhere you export `SCHEDULING_DRAIN_SECRET` to
   run `scripts/setup-production.ts` or `npm run scheduling:drain` by hand.

   Note that `npm run scheduling:drain` posts to `NEXT_PUBLIC_APP_URL`, which
   `.env.local` sets to `localhost` — so by default it drains your **local**
   stack, and a rotated production secret would look "verified" against the
   wrong database. To tick production, point it there explicitly:
   ```bash
   npm run scheduling:drain -- --url https://booklo.co
   # or: DRAIN_URL=https://booklo.co npm run scheduling:drain
   ```
   (`DRAIN_URL` also accepts the full route, so the Worker's own secret value
   can be pasted as-is.) Prefer the flag over exporting
   `NEXT_PUBLIC_APP_URL=https://booklo.co` shell-wide, which every other
   script would then also read.

Rotate all three **together**, in the same sitting. If you update the
Vercel value but not the Worker's, the next scheduled drain sends the old
secret and the route returns 401 — reminders silently stop going out until
someone notices (or the healthchecks.io alarm from §5 above fires, since a
401'd drain doesn't ping it either). There's no partial-rotation window that
is actually safe; treat it as one atomic change across three systems, not
three independent ones.
