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
| Sending identity | `noreply@mail.booklo.co` | Subdomain keeps automated-send reputation off the root domain. |
| Inbound support | Cloudflare Email Routing → Gmail | Free; DNS already at Cloudflare; Stripe activation requires a contact address. |
| Scheduler | Cloudflare Worker cron | Only genuinely free option at 15-minute granularity (§7). |
| Canonical host | apex `booklo.co`, `www` redirects to it | Public booking pages are handle-based URLs. |

The user chose the cheapest viable tier on every axis, with the explicit intent to upgrade once there are paying customers. §10 records what that buys and what it costs.

## 3. Topology

| Concern | Production |
|---|---|
| Host | Vercel Hobby, region **`fra1`**, Git auto-deploy **off** |
| Promotion | `.github/workflows/deploy.yml`, triggered by a green CI run on `main` |
| Schema | `drizzle-kit migrate` from GitHub Actions via the **session pooler** |
| Supabase config | `supabase config push --project-ref <ref>`, driven by `[remotes.production]` in `config.toml` |
| App mail | Resend API (`src/lib/email/transport.ts` already selects it when `RESEND_API_KEY` is set) |
| Auth mail | Resend **SMTP relay**, configured through `config.toml` |
| Inbound mail | Cloudflare Email Routing, `support@booklo.co` → Gmail |
| Scheduler | Cloudflare Worker, one cron trigger → `/api/scheduling/drain` |
| Liveness | Worker pings healthchecks.io after each successful drain (§7.1) |
| Backups | GitHub Actions, daily `pg_dump` via the session pooler |
| DNS | Cloudflare; **all** Vercel and Resend records **DNS-only (grey cloud)** |

Crons live on Cloudflare and backups on GitHub because `pg_dump` needs a filesystem a Worker does not have, and once daily is cheap enough that Actions is the simpler home.

## 4. The two `DATABASE_URL`s

This is the single most important correction in this design, and it contradicts the comment currently in `deploy.yml:11-13`.

Supabase **direct** connections (`db.<ref>.supabase.co:5432`) resolve to **IPv6 only**. The IPv4 add-on is Pro-and-above. GitHub-hosted runners are IPv4-only. A direct-connection `DATABASE_URL` therefore fails with `ENETUNREACH` on the first deploy, and again in the backup job.

The Supavisor shared pooler is IPv4 on every tier.

| Consumer | URL | Port | Why |
|---|---|---|---|
| GitHub Actions — `drizzle-kit migrate`, `pg_dump` | **session** pooler `...pooler.supabase.com` | `5432` | IPv4; session mode supports DDL and `pg_dump` |
| Vercel runtime — `src/db/index.ts` | **transaction** pooler `...pooler.supabase.com` | `6543` | IPv4; matches the existing `prepare: false` |

`src/db/index.ts:7` reads `process.env.DATABASE_URL!` directly, bypassing `src/env.ts` — so an unset value is a runtime crash on first query, not a build failure. §5 addresses that.

**Action:** correct the `deploy.yml` header comment, which currently instructs the operator to use the direct connection.

## 5. Environment variables

### 5.1 Vercel (Production scope)

```
NEXT_PUBLIC_SUPABASE_URL       https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY  <anon key>
NEXT_PUBLIC_APP_URL            https://booklo.co
SUPABASE_SERVICE_ROLE_KEY      <service role key>
DATABASE_URL                   <transaction pooler, :6543>
RESEND_API_KEY                 <resend key>
EMAIL_FROM                     Booklo <noreply@mail.booklo.co>
SCHEDULING_DRAIN_SECRET        <random, >=16 chars>
CHASE_DRAIN_SECRET             <random, >=16 chars>
INTERNAL_EMAILS                andriyshcherbyak@gmail.com
```

`BILLING_PROVIDER` stays unset (defaults to `fake`). With billing off for every org nothing can reach checkout; the fake provider's dev pages already 404 under `NODE_ENV === "production"` (`src/features/billing/dev/guard.ts`). Stripe variables arrive in a later slice.

`INTERNAL_EMAILS` is load-bearing: omit it and you are locked out of `/utils` on the exact deployment where you need it to flip your own billing flag.

### 5.2 GitHub repository secrets

```
DATABASE_URL      <session pooler, :5432>   # NOT the same value as Vercel's
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
```

Repository-level, **not** environment-level: GitHub environments and environment secrets are unavailable in private repositories on the Free plan, and this repo is private. `deploy.yml` drops its `environment: production` line accordingly. Environments buy a solo operator nothing here; the alternative is paying for GitHub Pro.

### 5.3 Cloudflare Worker secrets

```
DRAIN_URL                 https://booklo.co/api/scheduling/drain
SCHEDULING_DRAIN_SECRET   <same value as Vercel>
HEALTHCHECK_URL           <healthchecks.io ping URL>
```

### 5.4 Required-in-production validation

`src/env.ts` currently marks every server variable `.optional()`, and defaults `NEXT_PUBLIC_APP_URL` to `http://localhost:3000` (`src/env.ts:12`). That default is the most dangerous value in the file: it feeds `emailRedirectTo` in `src/features/auth/actions.ts:24,68,88`, every ICS link, and every manage/cancel link the product sends. Zod would never complain; every production email would simply carry `localhost` URLs.

Add a production-only refinement requiring: `NEXT_PUBLIC_APP_URL` (and rejecting a `localhost` value), `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `SCHEDULING_DRAIN_SECRET`, `INTERNAL_EMAILS`. Fail at boot, loudly, rather than at the first email.

## 6. Supabase config-as-code

`supabase/config.toml` is the source of truth for auth settings and the three custom email templates in `supabase/templates/`. Production is configured with `supabase config push --project-ref <ref>`, never by hand in the dashboard — push treats the file (plus CLI defaults for keys you never set) as authoritative, so any dashboard edit to a pushed key is silently reverted on the next push.

### 6.1 `[remotes.production]`, not `env()` for config

A `[remotes.production]` override block keyed to the production project ref keeps local values literal and production values in git:

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

`env()` interpolation was rejected for **non-secret** config: on CLI 2.75 an unset variable emits only `WARN: environment variable is unset` and substitutes the **empty string**, then exits 0 — so a forgotten shell export silently pushes a blank `site_url` to production. It is retained for the SMTP **password** only, where there is no alternative because the key must not be committed. The wizard verifies `RESEND_API_KEY` is exported before invoking push (§9).

There is no `--dry-run` on `config push` in 2.75.

**Unverified detail:** the `[remotes.production]` mechanism is confirmed working on the installed CLI, but the exact nesting of the sub-tables above (`[remotes.production.auth.email.smtp]` and friends) is written from the documented pattern, not from a run. Confirm it on the first push — this is why §9 has the wizard read `site_url` back from the remote rather than trusting exit code 0.

### 6.2 The rate limit that must be overridden

`config.toml:178` sets `email_sent = 2` under `[auth.rate_limit]`. That is a deliberate local value. Pushed to production, with `enable_confirmations = true` (`config.toml:205`), the **third signup in any hour silently never receives its confirmation email**. The override above is not optional.

### 6.3 Custom SMTP is a launch blocker, not a nicety

Without custom SMTP, Supabase Auth **refuses to deliver mail to any address outside the project team** — nobody but the owner can sign up. The built-in service is additionally capped at 2–30 messages/hour. With custom SMTP the default is 30 new users/hour, adjustable.

## 7. Scheduler

A single Cloudflare Worker with one cron trigger, every 15 minutes, POSTing to `/api/scheduling/drain` with `Authorization: Bearer ${SCHEDULING_DRAIN_SECRET}`.

Cloudflare Workers Free allows 100,000 requests/day and includes cron triggers; this uses ~96/day. GitHub Actions was rejected: a private repo gets 2,000 free minutes/month, runs bill at a 1-minute minimum, and 15-minute ticks are ~2,880 runs/month — over budget before CI. Vercel Cron was rejected: Hobby runs once per day at an arbitrary point in the hour.

**One trigger, not two.** The chase drain (`/api/chase/drain`) belongs to the legacy fire-safety engine; a fresh production database has zero rows for it. Scheduling a job with nothing to do is noise. `CHASE_DRAIN_SECRET` is still set in Vercel so the endpoint is not left in its 503 state, and adding the second trigger later is a three-line change.

### 7.1 Liveness

The drain's PostgREST traffic is what keeps a Free-tier project from pausing after ~7 days of low activity. So a dead Worker is not merely late reminders — drains stop, the database idles, and roughly a week later the entire site is down and needs a manual un-pause, from a failure that nothing alerts on.

The Worker pings a healthchecks.io check after each successful drain. Free, and it converts a silent week-long decay into an email within the hour.

## 8. Repo changes

| File | Change |
|---|---|
| `workers/cron/` (new) | Worker + `wrangler.toml` (one cron expression). Fetch logic pure and unit-tested. |
| `.github/workflows/backup.yml` (new) | Daily `pg_dump`, encrypted before upload |
| `.github/workflows/deploy.yml` | Uncomment the `workflow_run` trigger; drop `environment: production`; correct the direct-connection comment (§4) |
| `supabase/config.toml` | Add the `[remotes.production]` block (§6.1) |
| `src/env.ts` | Production-required validation (§5.4) |
| `.env.example` | Document production-only variables and the two-pooler distinction |
| `docs/runbook-production.md` (new) | Operator runbook: rotate a secret, restore a backup, un-pause the project, roll back a deploy |
| `scripts/setup-production.ts` (new) | The provisioning wizard (§9) |

### 8.1 Backup job specifics

Three independent failure modes, all addressed:

1. `ubuntu-latest` ships `pg_dump` 16; the hosted project is PostgreSQL 17 (`config.toml:36`) — a version mismatch aborts the dump. Install `postgresql-client-17` from PGDG.
2. An unscoped dump as `postgres` hits permission errors on `vault` and other internal schemas. Scope to `-n public -n auth -n storage`. **Dropping `auth` would make user accounts unrestorable** — it stays.
3. GitHub Free provides 500MB of total artifact storage with 90-day default retention; daily dumps exhaust it quietly. Set `retention-days: 7`.

The dump contains client names and email addresses. It is **encrypted before upload** — an unencrypted Actions artifact is a PII leak.

## 9. The provisioning wizard

Roughly half this slice is browser work only the operator can do. `scripts/setup-production.ts` walks it in order and **validates each step before allowing the next**, because the characteristic failure here is silent: a mistyped DKIM record looks fine for hours.

Checks, in order: domain resolves → Vercel project linked and region is `fra1` → Supabase project linked → session pooler reachable from this machine → `RESEND_API_KEY` exported → Resend domain verified → SMTP authenticates → `config push` applied and `site_url` reads back correctly → migrations applied (`0046` present) → deployment returns 200 → drain endpoint returns 200 for a valid Bearer and 401 for a bad one → Worker cron registered.

The wizard is idempotent and re-runnable; it reports state, it does not assume a fresh start.

## 10. Risks accepted, and their upgrade triggers

| Risk | Trigger to fix |
|---|---|
| **Vercel Hobby forbids commercial use** | Upgrade to Pro **before** billing goes live for customers. Note the bad timing: a suspension while a Stripe eligibility review is open. |
| Resend 100/day shared across auth + confirmations + staff notices + reminders — roughly 25–30 bookings/day saturates it, after which reminder rows burn their 5 attempts against 429s | First day exceeding 60 sends |
| Supabase Free: 500MB, no PITR — the daily dump is the only restore path, with up to 24h of loss | First paying customer |
| Supabase Free pauses after ~7 quiet days | Mitigated by the drain traffic; healthchecks.io (§7.1) is the alarm |
| Vercel's 4.5MB request-body cap overrides `next.config.ts`'s `bodySizeLimit: "16mb"` | Contained today — evidence upload is legacy/hidden. Any future photo flow needs direct-to-storage signed uploads, not a server-action relay. |

## 11. Cutover

Each step is verifiable before the next.

1. **Supabase project** — create (Frankfurt), `supabase link`, record both pooler URLs.
2. **Resend** — account, API key, verify `mail.booklo.co`, add DNS at Cloudflare (**grey cloud**), wait for verification. *Must precede step 4.*
3. **Cloudflare Email Routing** — `support@booklo.co` → Gmail.
4. **`supabase config push`** — one push carrying SMTP, `site_url`, redirect allowlist, rate limits and templates together.
5. **Migrate** — `drizzle-kit migrate` against the session pooler. Watch the first hosted run; storage buckets are provisioned by migrations `0015`/`0018`, so no manual bucket setup is needed.
6. **Vercel** — create project, `vercel link`, set env (§5.1), **set region `fra1`**, add `booklo.co` + `www` redirect, disable Git auto-deploy.
7. **First deploy** — `workflow_dispatch` on `deploy.yml`.
8. **Cloudflare Worker** — `wrangler deploy`, set secrets, confirm the first tick.
9. **Smoke test** (§12).
10. **Enable auto-deploy** — uncomment the `workflow_run` trigger.

Step 2 before step 4 matters: pushing an `[auth.email.smtp]` block before the Resend domain is verified means auth mail is rejected at send.

## 12. Smoke test

Run against production, from an address that is **not** the owner's — that is the entire point, since the custom-SMTP failure mode (§6.3) is invisible to the account owner.

1. Sign up as a non-owner address → confirmation email arrives, from `noreply@mail.booklo.co`, with **`https://booklo.co`** links, not localhost.
2. Confirm → land in onboarding → complete it.
3. Open the public booking page; take a booking as a client.
4. Confirmation email to the client, notification to the provider.
5. **Reminder:** create a booking starting **~24h15m out**, then wait for the lead window to open plus one cron tick. A booking made inside the 24h window is deliberately suppressed (`src/features/scheduling/reminders.ts:31` — "the confirmation just arrived"), so a same-day test proves nothing and will read as a broken reminder system.
6. Sign in as the owner, reach `/utils` (confirms `INTERNAL_EMAILS`).
7. Password reset end-to-end.
8. healthchecks.io shows a green ping.

## 13. Follow-ups

- `/pricing` + `/contact` marketing slice — required before the Stripe application.
- Stripe Managed Payments: apply, sandbox dry run, then live wiring.
- Supabase new API key migration before the end-of-2026 deprecation.
- Vercel Pro upgrade at the §10 trigger.
