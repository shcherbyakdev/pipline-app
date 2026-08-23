# Launch Infrastructure — Design

**Date:** 2026-08-19
**Status:** approved, not yet implemented
**Domain:** `booklo.co`

## 1. Goal

Put Booklo in production at `https://booklo.co`, reachable by real users, with billing dormant. This unblocks the Stripe Managed Payments eligibility review, which requires a publicly reachable business website that shows what is sold and how to contact support.

The app has never been deployed. There is no production environment. Everything below is first-time provisioning.

### Non-goals

- Enabling billing. `FLAG_DEFAULTS.billing` stays `false` (`src/lib/flags/index.ts`). After deploy it is switched on **per-org for the owner only**, via `/utils/flags`, to dry-run Stripe against production without exposing a pricing surface to anyone else.
- The `/pricing` and `/contact` marketing changes. Required before the Stripe *application*, not before the deploy. Separate slice.
- Migrating to Supabase's new `sb_publishable_` / `sb_secret_` API keys. Legacy `anon` / `service_role` keys still work and are deprecated end-of-2026; the new keys are not drop-in (they cannot ride `Authorization: Bearer`), so this is a deliberate later task.

## 2. Constraints and decisions

| Decision | Choice | Rationale |
|---|---|---|
| Hosting | Vercel **Hobby** | Cheapest. Upgrade gated on billing going live (§10). |
| Database + Auth | Supabase **Free**, EU Central (Frankfurt) | Cheapest; nearest region to PL; keeps data in-EU. |
| Email | Resend **Free** | 100/day, 3,000/month, 1 domain, SMTP relay included. |
| Sending identity | `noreply@booklo.co` | Resend Free verifies one domain and the apex was already verified. Resend's return-path MX/SPF sit on `send.booklo.co`, so inbound Email Routing at the apex is unaffected. |
| Inbound support | Cloudflare Email Routing → Gmail | Free; DNS already at Cloudflare; Stripe activation requires a contact address. |
| Scheduler | Cloudflare Worker cron | Only genuinely free option at 15-minute granularity (§7). |
| Canonical host | apex `booklo.co`, `www` redirects to it | Public booking pages are handle-based URLs. |
| Git ↔ Vercel | **Never connect the repo to Vercel** | `deploy.yml` already uses Vercel's documented token + `--prebuilt` CI flow, which needs no Git connection. Not connecting is simpler and safer than connecting and disabling. |

The user chose the cheapest viable tier on every axis, with the explicit intent to upgrade once there are paying customers. §10 records what that buys and what it costs.

## 3. Topology

| Concern | Production |
|---|---|
| Host | Vercel Hobby, region **`fra1`** via `vercel.json`, no Git connection |
| Promotion | `.github/workflows/deploy.yml`, triggered by a green CI run on `main` |
| Schema | `drizzle-kit migrate` from GitHub Actions via the **session pooler** |
| Supabase config | `supabase config push --project-ref <ref> --yes`, driven by `[remotes.production]` |
| App mail | Resend API (`src/lib/email/transport.ts` already selects it when `RESEND_API_KEY` is set) |
| Auth mail | Resend **SMTP relay**, configured through `config.toml` |
| Inbound mail | Cloudflare Email Routing, `support@booklo.co` → Gmail |
| Scheduler | Cloudflare Worker, one cron trigger → `/api/scheduling/drain` |
| Liveness | Worker pings healthchecks.io after each successful drain (§7.1) |
| Backups | GitHub Actions, daily `supabase db dump` via the session pooler |
| DNS | Cloudflare; **all** Vercel and Resend records **DNS-only (grey cloud)** |

Crons live on Cloudflare and backups on GitHub because dumping needs a filesystem a Worker does not have, and once daily is cheap enough that Actions is the simpler home.

## 4. The two `DATABASE_URL`s

This is the most important correction in this design, and it contradicts the comment currently in `deploy.yml:11-13`.

Supabase **direct** connections (`db.<ref>.supabase.co:5432`) resolve to **IPv6 only**. The IPv4 add-on is Pro-and-above. GitHub-hosted runners are IPv4-only. A direct-connection `DATABASE_URL` therefore fails with `ENETUNREACH` on the first deploy, and again in the backup job.

The Supavisor shared pooler is IPv4 on every tier.

| Consumer | URL | Port | Why |
|---|---|---|---|
| GitHub Actions — migrate, dump | **session** pooler `...pooler.supabase.com` | `5432` | IPv4; session mode supports DDL and dumping |
| Vercel runtime — `src/db/index.ts` | **transaction** pooler `...pooler.supabase.com` | `6543` | IPv4; matches the existing `prepare: false` |

The migrations are pooler-safe: no `CONCURRENTLY`, no `ALTER SYSTEM`, and advisory locks appear only inside function bodies (runtime, not migration time). The known drizzle hang is against the *transaction* pooler; port 5432 session mode is the documented fix.

`src/db/index.ts:7` reads `process.env.DATABASE_URL!` directly, bypassing `src/env.ts` — so an unset value is a runtime crash on first query, not a build failure. §5.4 addresses that.

**Action:** rewrite the `deploy.yml` header comment entirely. It currently instructs both the direct connection (wrong, §4) *and* creating a GitHub Environment (impossible, §5.2).

## 5. Environment variables

### 5.1 Vercel (Production scope)

```
APP_ENV                        production
NEXT_PUBLIC_SUPABASE_URL       https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY  <anon key>
NEXT_PUBLIC_APP_URL            https://booklo.co
SUPABASE_SERVICE_ROLE_KEY      <service role key>
DATABASE_URL                   <transaction pooler, :6543>
RESEND_API_KEY                 <resend key>
EMAIL_FROM                     Booklo <noreply@booklo.co>
SCHEDULING_DRAIN_SECRET        <random, >=16 chars>
CHASE_DRAIN_SECRET             <random, >=16 chars>
INTERNAL_EMAILS                andriishcherbiakdev@gmail.com,andriyshcherbyak@gmail.com
```

`BILLING_PROVIDER` stays unset (defaults to `fake`). With billing off for every org nothing can reach checkout; the fake provider's dev pages already 404 under `NODE_ENV === "production"` (`src/features/billing/dev/guard.ts`). Stripe variables arrive in a later slice.

`INTERNAL_EMAILS` is load-bearing: omit it and you are locked out of `/utils` on the exact deployment where you need it to flip your own billing flag. It is a comma-separated allowlist and both of the owner's addresses are listed deliberately — the canonical one is `andriishcherbiakdev@gmail.com` (it is also the Cloudflare Email Routing destination for `support@booklo.co`), and the second is kept only as a lockout hedge. Widening it to a second address the owner already controls costs nothing; guessing wrong costs the admin panel.

Because `vercel pull --environment=production` runs before `vercel build`, `NEXT_PUBLIC_*` values are inlined from the Vercel project env at deploy time. **Consequence for the runbook: editing `NEXT_PUBLIC_APP_URL` in the Vercel dashboard changes nothing until the next CI deploy.**

### 5.2 GitHub repository secrets

```
DATABASE_URL       <session pooler, :5432>   # NOT the same value as Vercel's
VERCEL_TOKEN
VERCEL_ORG_ID                                # from .vercel/project.json after `vercel link`
VERCEL_PROJECT_ID                            # same
BACKUP_PASSPHRASE  <random, >=32 chars>      # symmetric key for §8.1
```

Repository-level, **not** environment-level: GitHub environments and environment secrets are unavailable in private repositories on the Free plan, and this repo is private. `deploy.yml` drops its `environment: production` line accordingly.

### 5.3 Cloudflare Worker secrets

```
DRAIN_URL                 https://booklo.co/api/scheduling/drain
SCHEDULING_DRAIN_SECRET   <same value as Vercel>
HEALTHCHECK_URL           <healthchecks.io ping URL>
```

### 5.4 Production-required validation — gated on `APP_ENV`, not `NODE_ENV`

`src/env.ts` marks every server variable `.optional()` and defaults `NEXT_PUBLIC_APP_URL` to `http://localhost:3000` (`src/env.ts:12`). That default is the most dangerous value in the file: it feeds `emailRedirectTo` (`src/features/auth/actions.ts:24,68,88`), every ICS link, and every manage/cancel link the product sends. Zod never complains; every production email simply carries `localhost` URLs.

Add a refinement requiring `NEXT_PUBLIC_APP_URL` (non-localhost), `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `SCHEDULING_DRAIN_SECRET`, `INTERNAL_EMAILS`.

**It must be gated on `APP_ENV === "production"`, never `NODE_ENV`.** `NODE_ENV` is `production` inside *every* `next build`, including CI's build job — which deliberately supplies three placeholder values, one of them `NEXT_PUBLIC_APP_URL: http://localhost:3000` (`ci.yml:52-58`). A `NODE_ENV` gate turns CI red; `deploy.yml` triggers on green CI; nothing could ever deploy again. `APP_ENV` is set only in the Vercel project (§5.1), so it is present during `vercel build` and absent in CI — exactly the discrimination required.

## 6. Supabase config-as-code

`supabase/config.toml` is the source of truth for auth settings and the three custom email templates in `supabase/templates/`. Production is configured with `supabase config push --project-ref <ref> --yes`, never by hand in the dashboard.

Two properties of push, both source-verified against CLI v2.75.0:

- It sends the **full config body** assembled from your file plus CLI defaults — so any dashboard edit to a pushed key is silently reverted on the next push.
- It covers **API, database and storage settings too, not only auth**. Review the entire diff on the first push rather than assuming an auth-only blast radius.
- Push prompts per service, and in a non-TTY auto-answers **yes** within milliseconds. Always pass `--yes` explicitly so the behaviour is intentional rather than incidental.

### 6.1 The `[remotes.production]` block

Verified to parse clean against the installed CLI 2.75.0 — meaningful because the decoder is strict and rejects unknown keys, so a clean parse means every key name is recognised. Paste as-is with the real ref:

```toml
[remotes.production]
project_id = "<prod ref>"

[remotes.production.auth]
site_url = "https://booklo.co"
additional_redirect_urls = ["https://booklo.co", "https://booklo.co/auth/confirm"]

[remotes.production.auth.rate_limit]
email_sent = 30

[remotes.production.auth.email.smtp]
enabled = true
host = "smtp.resend.com"
port = 465
user = "resend"
pass = "env(RESEND_API_KEY)"
admin_email = "support@booklo.co"
sender_name = "Booklo"
```

`env()` interpolation is rejected for **non-secret** config: on CLI 2.75 an unset variable emits only `WARN: environment variable is unset` and substitutes the **empty string**, then exits 0. It is retained for the SMTP **password** only, where there is no alternative because the key must not be committed.

`rate_limit.email_sent` is pushed **only when `smtp.enabled = true` in the same effective config**. The block above satisfies that — but if SMTP is ever disabled here, the rate-limit override silently stops being pushed too.

There is no `--dry-run` on `config push` in 2.75.

### 6.2 The silent-skip trap

If `project_id` under `[remotes.production]` does not match the `--project-ref` argument — a leftover placeholder, a typo — **the CLI silently skips the override and pushes the base config**: `site_url = "http://localhost:3000"` (`config.toml:150`), `email_sent = 2`, no SMTP. No error, no non-zero exit. That is every failure mode in §6.3 and §6.4, self-inflicted and invisible.

`project_id` now carries the real production ref (`fkxtjtgwzwhwugxchuxo`, substituted at cutover step 2). Any placeholder that ever stands in for it must be **format-valid but fake** — 20 lowercase letters — never "deliberately invalid". The config decoder validates `[remotes.*].project_id` on essentially every command, not just remote ones (`supabase start`, `status`, `db reset`, this project's `predev` preflight); an invalid-format placeholder breaks all of those outright, which is a worse failure than the trap it would be guarding against. Format-valid-but-fake lets the CLI decode the file while never matching a real `--project-ref`.

One assertion guards the trap in the wizard (§9): the target ref must appear as a `remotes.*.project_id` in `config.toml` *before* pushing. The other is an operator check in the runbook (§2), not the wizard: `pushAppliedOverride` exists and is unit-tested, but nothing in the wizard calls it — the operator runs `config push` themselves and confirms `Loading config override` in the output by eye.

Sequencing consequence: the real project ref only exists after §11 step 1, so the `[remotes.production]` block cannot be finalised until then. §11 sequences this explicitly.

### 6.3 The rate limit that must be overridden

`config.toml:178` sets `email_sent = 2` under `[auth.rate_limit]` — a deliberate local value. Pushed to production, with `enable_confirmations = true` (`config.toml:205`), the **third signup in any hour silently never receives its confirmation email**.

### 6.4 Custom SMTP is a launch blocker, not a nicety

Without custom SMTP, Supabase Auth **refuses to deliver mail to any address outside the project team** — nobody but the owner can sign up. The built-in service is additionally capped at 2–30 messages/hour. With custom SMTP the default is 30 new users/hour, adjustable.

## 7. Scheduler

A single Cloudflare Worker with one cron trigger, every 15 minutes, POSTing to `/api/scheduling/drain` with `Authorization: Bearer ${SCHEDULING_DRAIN_SECRET}`.

Cloudflare Workers Free allows 100,000 requests/day and includes cron triggers; this uses ~96/day. GitHub Actions was rejected: a private repo gets 2,000 free minutes/month at a 1-minute minimum, and 15-minute ticks are ~2,880 runs/month. Vercel Cron was rejected: Hobby runs once per day at an arbitrary point in the hour.

**One trigger, not two.** The chase drain (`/api/chase/drain`) belongs to the legacy fire-safety engine and a fresh production database has zero rows for it. `CHASE_DRAIN_SECRET` is still set so the endpoint is not left in its 503 state; adding the second trigger later is a three-line change.

The Worker is ~30 lines. One unit test over the request-building logic, no test harness.

### 7.1 Liveness

The drain's traffic is what keeps a Free-tier project from pausing after ~7 days of low activity. A dead Worker is therefore not merely late reminders: drains stop, the database idles, and roughly a week later the entire site is down needing a manual un-pause — from a failure nothing alerts on.

The Worker pings a healthchecks.io check after each successful drain. Free, and it converts a silent week-long decay into an email within the hour.

## 8. Repo changes

| File | Change |
|---|---|
| `workers/cron/` (new) | Worker + `wrangler.toml` (one cron expression) + one unit test |
| `.github/workflows/backup.yml` (new) | Daily encrypted `supabase db dump` (§8.1) |
| `.github/workflows/deploy.yml` | Drop `environment: production`; rewrite the header comment (§4). **Leave the `workflow_run` trigger commented.** |
| `vercel.json` (new) | `{"regions": ["fra1"]}` |
| `supabase/config.toml` | Add `[remotes.production]` (§6.1) — finalised after §11 step 1 |
| `src/env.ts` | `APP_ENV`-gated production validation (§5.4) |
| `.env.example` | Document production-only variables and the two-pooler distinction |
| `docs/runbook-production.md` (new) | Rotate a secret, restore a backup, un-pause the project, roll back a deploy |
| `scripts/setup-production.ts` (new) | The provisioning wizard (§9) |

**The repo-change PR must keep the `workflow_run` trigger commented out.** Uncommenting it is §11 step 11, its own one-line PR, after the environment exists. Otherwise every merge to `main` from that moment attempts a production deploy into nothing.

### 8.1 Backup job

Use `supabase db dump --db-url <session pooler>` rather than raw `pg_dump`. It ships a version-matched dump binary, which removes the failure mode where `ubuntu-latest`'s client 16 aborts against the hosted PostgreSQL 17 (`config.toml:36`).

**Two dumps per run.** A bare `supabase db dump` runs `pg_dump --schema-only`: on its own it looks like a backup and restores an empty database. The job therefore takes a schema dump (`schema.sql`) *and* a data dump (`--data-only --use-copy`, `data.sql`), and fails if `data.sql` contains no `COPY` block — an empty data dump must not upload green. The data file is the backup; the schema file is a reference copy.

Schemas: `public`, `auth`, `storage`, **and `drizzle`**. The `drizzle` schema holds `__drizzle_migrations`, the migration journal — restore without it and the next `drizzle-kit migrate` re-runs the full migration chain against an already-populated schema. Dropping `auth` would make user accounts unrestorable.

The dump contains client names and email addresses. **Encrypt before upload** using `BACKUP_PASSPHRASE` (§5.2) — an unencrypted Actions artifact is a PII leak. Set `retention-days: 7`; GitHub Free provides 500MB of total artifact storage with a 90-day default that daily dumps would quietly exhaust.

Restore (runbook §4): recreate the schema by applying the migration chain at the backup's commit, then `psql -f data.sql`. `schema.sql` is not applied on a Supabase target — its `auth` and `storage` DDL is owned by `supabase_auth_admin` / `supabase_storage_admin`, which only a Supabase-provisioned project has, and `drizzle-kit migrate` already owns `public`/`drizzle`.

## 9. The provisioning wizard

`scripts/setup-production.ts` validates the steps whose failure is *silent*. Checks whose failure is loud and immediate (a 500 page, a missing region) are not worth scripting.

**Credentials the wizard needs, and must check for up front:** `SUPABASE_ACCESS_TOKEN` (Management API), `RESEND_API_KEY`, `SCHEDULING_DRAIN_SECRET`, and the session-pooler `DATABASE_URL`.

Checks, in the order §11 makes them true:

1. `supabase/config.toml` contains a `remotes.*.project_id` equal to the target ref (§6.2).
2. `config push --yes` output contains `Loading config override` (§6.2).
3. `site_url` read back from the Management API equals `https://booklo.co`.
4. Resend reports `booklo.co` **verified** (Resend API, not eyeballed).
5. **Deferred, not implemented.** DNS: apex resolves to Vercel; the Resend records exist under `booklo.co`. Deferred because the two halves are already covered elsewhere: the Resend `verified` check (item 4) implies its DNS records are correct, and a wrong apex fails loudly — the site simply doesn't load — so it isn't the class of silent failure this wizard exists to catch.
6. Migrations: row count in `drizzle.__drizzle_migrations` equals the entry count in `src/db/migrations/meta/_journal.json` — *not* "0046 exists", which goes stale with every new migration and will go staler when the parked R3 work renumbers.
7. Drain: valid Bearer → 200, bad Bearer → 401. Note that the valid call runs a real tick; harmless, but it is not a dry run.

Deliberately **not** checked: "SMTP authenticates" (there is no client to build it on — `src/lib/email/smtp.ts` is plaintext, no-auth, Mailpit-only; §12 step 1 is the real proof), "session pooler reachable from this machine" (validates the wrong machine — the GitHub migrate step is the real test), "deployment returns 200" and "region is `fra1`" (loud failures; the latter is now a line in `vercel.json`).

The wizard is idempotent and re-runnable; it reports state rather than assuming a fresh start.

## 10. Risks accepted, and their upgrade triggers

| Risk | Trigger to fix |
|---|---|
| **Vercel Hobby forbids commercial use** | Upgrade to Pro **before** billing goes live for customers. Note the bad timing: a suspension while a Stripe eligibility review is open. |
| Resend 100/day shared across auth + confirmations + staff notices + reminders — roughly 25–30 bookings/day saturates it, after which reminder rows burn their 5 attempts against 429s | First day exceeding 60 sends |
| Supabase Free: 500MB, no PITR — the daily dump is the only restore path, up to 24h of loss | First paying customer |
| Supabase Free pauses after ~7 quiet days | Mitigated by drain traffic; healthchecks.io (§7.1) is the alarm |
| Vercel's 4.5MB request-body cap overrides `next.config.ts`'s `bodySizeLimit: "16mb"` | Contained — evidence upload is legacy/hidden. Any future photo flow needs direct-to-storage signed uploads, not a server-action relay. |
| `support@booklo.co` is **receive-only**: Resend Free allows one domain (`booklo.co`), so there is no send-as path — replies visibly come from the Gmail address | Cosmetic; revisit if the Stripe reviewer or customers react to it |

### 10.1 Unverified assumptions

- **Next.js 16.3's `src/proxy.ts` and Node 24 functions deploying cleanly through Vercel CLI 58's prebuilt output.** Very likely, not verified. Confirm on the first deploy; it is the most plausible source of a surprising first-deploy failure.
- `vercel@^58.0.0` currently resolves one major behind npm latest (59.x). Intended per the existing pin comment, noted so it is not mistaken for drift.

## 11. Cutover

Each step is verifiable before the next.

1. **Supabase project** — create (Frankfurt), `supabase link`, record the ref and **both** pooler URLs.
2. **Finalise and merge the §8 repo changes** — with the real ref in `[remotes.production]`, and the `workflow_run` trigger still commented.
3. **Resend** — account, API key, verify `booklo.co`, create its DNS records at Cloudflare (**grey cloud**), wait for verified status. *Must precede step 5.*
4. **Cloudflare Email Routing** — `support@booklo.co` → Gmail. Its records live at the apex; Resend's return-path MX and SPF live under `send.booklo.co` and its DKIM at `resend._domainkey`. **No collision** — the apex MX and apex SPF stay free for Email Routing.
5. **`supabase config push --project-ref <ref> --yes`** — one push carrying SMTP, `site_url`, redirect allowlist, rate limits and templates. Confirm `Loading config override` appears. Review the full diff: push covers API/DB/storage, not just auth.
6. **Migrate** — `DATABASE_URL='<session pooler :5432>' npx drizzle-kit migrate`. The explicit prefix is required: `drizzle.config.ts` calls `loadEnvFile(".env.local")`, so a bare invocation silently migrates your **local** stack. (An exported shell variable takes precedence over the file, which is why the prefix works.)
7. **Vercel** — create project (do **not** connect Git), `vercel link`, set env (§5.1), add `booklo.co` + `www` redirect.
8. **Cloudflare DNS for Vercel** — add the records Vercel's domain card displays, apex and `www`, **grey cloud**. Apex CNAME flattening is automatic on all Cloudflare plans, including DNS-only records.
9. **GitHub secrets** (§5.2) — `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` come from `.vercel/project.json`, written by step 7's `vercel link`.
10. **healthchecks.io** — create the check, record its ping URL.
11. **First deploy** — `workflow_dispatch` on `deploy.yml`.
12. **Cloudflare Worker** — `wrangler deploy`, set secrets (§5.3), confirm the first tick and the first healthcheck ping.
13. **Smoke test** (§12).
14. **Enable auto-deploy** — the one-line PR uncommenting the `workflow_run` trigger.

Step 3 before step 5 matters: pushing an `[auth.email.smtp]` block before the Resend domain is verified means auth mail is rejected at send.

## 12. Smoke test

Run against production from an address that is **not** the owner's — that is the whole point, since the custom-SMTP failure mode (§6.4) is invisible to the account owner.

1. Sign up as a non-owner address → confirmation arrives, from `noreply@booklo.co`, with **`https://booklo.co`** links, not localhost.
2. Confirm → onboarding → complete it.
3. Open the public booking page; take a booking as a client.
4. Confirmation to the client, notification to the provider.
5. **Reminder:** create a booking starting **~24h15m out**, then wait for the lead window to open plus one cron tick. A booking made inside the 24h window is deliberately suppressed (`src/features/scheduling/reminders.ts:29-31` — "the confirmation just arrived"), so a same-day test proves nothing and will read as a broken reminder system.
6. Sign in as the owner, reach `/utils` (confirms `INTERNAL_EMAILS`).
7. Password reset end-to-end.
8. healthchecks.io shows a green ping.

## 13. Follow-ups

- `/pricing` + `/contact` marketing slice — required before the Stripe application.
- Stripe Managed Payments: apply, sandbox dry run, then live wiring.
- Supabase new API key migration before the end-of-2026 deprecation.
- Vercel Pro upgrade at the §10 trigger.
