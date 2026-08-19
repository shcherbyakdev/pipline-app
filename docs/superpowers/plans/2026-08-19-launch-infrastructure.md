# Launch Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the repo-side changes that make a production deployment of Booklo at `https://booklo.co` possible, safe, and verifiable — leaving only browser provisioning for the operator, driven by a wizard.

**Architecture:** Six independent deliverables. An `APP_ENV`-gated env guard that fails a production build rather than a production email; corrections to the existing (written but never executed) deploy workflow; a Cloudflare Worker that drives the reminder drain and reports liveness; an encrypted daily backup workflow; a provisioning wizard that validates only the silent-failure cases; and an operator runbook plus the `[remotes.production]` Supabase config block.

**Tech Stack:** Next.js 16 (App Router), Supabase (hosted, Free tier), Drizzle, Vitest, GitHub Actions, Cloudflare Workers (Wrangler), Vercel CLI, Resend.

**Spec:** `docs/superpowers/specs/2026-08-19-launch-infrastructure-design.md`

## Global Constraints

- Branch: `infra/launch-production`. Conventional commit per task. Run `npm run verify` (lint + typecheck + test) before every commit.
- **Do NOT uncomment the `workflow_run` trigger in `.github/workflows/deploy.yml`.** It stays commented until cutover step 14 (spec §11), as its own one-line PR. Uncommenting it here makes every merge to `main` attempt a deploy into an environment that does not exist.
- **Never gate production behaviour on `NODE_ENV`.** `NODE_ENV === "production"` is true inside every `next build`, including CI's build job, which supplies placeholder values (`ci.yml:52-58`). Use `APP_ENV`, set only in the Vercel project.
- Two different `DATABASE_URL` values exist (spec §4): GitHub Actions uses the **session** pooler (`...pooler.supabase.com:5432`); the Vercel runtime uses the **transaction** pooler (`:6543`). Never conflate them.
- No secrets in committed files. The Supabase SMTP password is the single `env()` interpolation, by necessity.
- Domain is `booklo.co`; sending identity is `Booklo <noreply@mail.booklo.co>`; support address is `support@booklo.co`.

---

### Task 1: `APP_ENV`-gated production env validation

**Files:**
- Modify: `src/env.ts`
- Create: `src/env.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: nothing.
- Produces: `envSchema` exported from `src/env.ts` (a Zod schema; `envSchema.safeParse(record)` returns the standard Zod result). `env` continues to be the parsed singleton export it is today.

The schema is exported specifically so the refinement can be tested by calling `safeParse` on a plain object — no module-reset or `stubEnv` gymnastics, and no import-time side effects in the test.

- [ ] **Step 1: Write the failing test**

Create `src/env.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { envSchema } from "./env";

// The three values CI's build job actually supplies (.github/workflows/ci.yml:52-58).
const CI_BUILD_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54351",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "ci-placeholder-anon-key",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
};

const PROD_ENV = {
  APP_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefgh.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  NEXT_PUBLIC_APP_URL: "https://booklo.co",
  DATABASE_URL: "postgresql://postgres:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  RESEND_API_KEY: "re_test_key",
  EMAIL_FROM: "Booklo <noreply@mail.booklo.co>",
  SCHEDULING_DRAIN_SECRET: "0123456789abcdef0123",
  INTERNAL_EMAILS: "owner@example.com",
};

describe("envSchema", () => {
  // Regression guard: a NODE_ENV-based gate would fail this, turning CI red.
  // deploy.yml triggers on a green CI run, so that would make the pipeline
  // permanently undeployable.
  it("accepts CI's placeholder build env, because APP_ENV is absent", () => {
    expect(envSchema.safeParse(CI_BUILD_ENV).success).toBe(true);
  });

  it("accepts a complete production env", () => {
    expect(envSchema.safeParse(PROD_ENV).success).toBe(true);
  });

  it("rejects a localhost app url in production", () => {
    const result = envSchema.safeParse({ ...PROD_ENV, NEXT_PUBLIC_APP_URL: "http://localhost:3000" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain("NEXT_PUBLIC_APP_URL");
    }
  });

  it.each([
    "DATABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "RESEND_API_KEY",
    "EMAIL_FROM",
    "SCHEDULING_DRAIN_SECRET",
    "INTERNAL_EMAILS",
  ])("rejects production without %s", (key) => {
    const incomplete: Record<string, unknown> = { ...PROD_ENV };
    delete incomplete[key];
    const result = envSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain(key);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/env.test.ts`
Expected: FAIL — `envSchema` is not exported from `src/env.ts`.

- [ ] **Step 3: Implement**

In `src/env.ts`, add `APP_ENV` to the object schema (immediately after the `NEXT_PUBLIC_APP_URL` line):

```ts
  // Production marker. NOT NODE_ENV: that is "production" inside every
  // `next build`, including CI's, which supplies placeholder values. Set
  // only in the Vercel project, so it is present during `vercel build`
  // and absent in CI — which is exactly the discrimination we need.
  APP_ENV: z.enum(["development", "production"]).optional(),
```

Add `APP_ENV: process.env.APP_ENV,` to the object passed to `envSchema.parse(...)` at the bottom of the file.

Change `const envSchema = z.object({...})` to `export const envSchema = z.object({...})` and chain the refinement onto it:

```ts
}).superRefine((value, ctx) => {
  if (value.APP_ENV !== "production") return;

  // Everything below is optional in the base schema because local
  // development legitimately runs without it. In production each one is
  // load-bearing, and the failure mode of a missing value is silent:
  // NEXT_PUBLIC_APP_URL in particular defaults to localhost and would put
  // localhost links in every email the product sends.
  const required = [
    "DATABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "RESEND_API_KEY",
    "EMAIL_FROM",
    "SCHEDULING_DRAIN_SECRET",
    "INTERNAL_EMAILS",
  ] as const;

  for (const key of required) {
    if (!value[key]) {
      ctx.addIssue({ code: "custom", path: [key], message: `${key} is required when APP_ENV=production` });
    }
  }

  if (/localhost|127\.0\.0\.1/.test(value.NEXT_PUBLIC_APP_URL)) {
    ctx.addIssue({
      code: "custom",
      path: ["NEXT_PUBLIC_APP_URL"],
      message: "NEXT_PUBLIC_APP_URL must not be localhost when APP_ENV=production",
    });
  }
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/env.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Document the new variables**

Append to `.env.example`:

```
# --- Production only (spec 2026-08-19-launch-infrastructure) ---
# Set ONLY in the Vercel project. Its presence switches on the required-var
# checks in src/env.ts. Never set it locally or in CI.
APP_ENV=
# Owner allowlist for /utils. Comma-separated. Omit it in production and you
# are locked out of the back office on the deployment that needs it.
INTERNAL_EMAILS=
#
# NOTE ON DATABASE_URL: production uses TWO different values.
#   Vercel runtime  -> transaction pooler, ...pooler.supabase.com:6543
#   GitHub Actions  -> session pooler,     ...pooler.supabase.com:5432
# The direct connection (db.<ref>.supabase.co:5432) is IPv6-only and is
# unreachable from GitHub-hosted runners.
```

- [ ] **Step 6: Verify and commit**

Run: `npm run verify`
Expected: PASS.

```bash
git add src/env.ts src/env.test.ts .env.example
git commit -m "feat(env): APP_ENV-gated production variable validation"
```

---

### Task 2: Correct the deploy workflow and pin the Vercel region

**Files:**
- Create: `vercel.json`
- Modify: `.github/workflows/deploy.yml:1-16` (header comment), and the `environment: production` line

**Interfaces:**
- Consumes: nothing.
- Produces: a `deploy.yml` whose documented prerequisites are achievable, and a committed `fra1` region that the wizard need not check.

- [ ] **Step 1: Create `vercel.json`**

```json
{
  "regions": ["fra1"]
}
```

The Supabase project is in Frankfurt. Vercel's default function region is US East, so without this every request pays a transatlantic round trip per query. Hobby allows exactly one region; config-as-code beats a dashboard setting nobody remembers.

- [ ] **Step 2: Replace the `deploy.yml` header comment**

The current comment is wrong twice: it instructs a direct-connection `DATABASE_URL` (IPv6-only, unreachable from runners) and instructs creating a GitHub Environment (unavailable on private repos on the Free plan). Replace lines 3-16 with:

```yaml
# ─── DEPLOYS DISABLED until cutover step 14 ───────────────────────────────────
# The automatic trigger below is commented out, so this workflow never fires on
# its own. Manual `workflow_dispatch` is how the first deploy is performed.
#
# To enable automatic deploys (spec 2026-08-19-launch-infrastructure §11):
#   1. Uncomment the `workflow_run` block below. This is its own one-line PR,
#      done LAST — before the environment exists it would deploy into nothing.
#   2. Set these as REPOSITORY secrets (not environment secrets: GitHub
#      environments are public-repo-only on the Free plan, and this repo is
#      private):
#        DATABASE_URL       Supabase SESSION pooler, ...pooler.supabase.com:5432
#                           NOT the direct connection (db.<ref>.supabase.co) —
#                           that is IPv6-only and GitHub runners are IPv4-only.
#                           NOT the transaction pooler (:6543) — that is the
#                           Vercel runtime's value and cannot run DDL reliably.
#        VERCEL_TOKEN
#        VERCEL_ORG_ID      from .vercel/project.json, written by `vercel link`
#        VERCEL_PROJECT_ID  same
#   3. The Vercel project must NOT be connected to Git. This workflow uses
#      Vercel's token + `--prebuilt` CI flow, which needs no Git connection;
#      connecting one would race this workflow's migration step.
# ──────────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 3: Remove the unusable environment reference**

Delete the `environment: production` line from the `deploy` job (currently `deploy.yml:41`). Leave `timeout-minutes: 20` and the concurrency group untouched.

- [ ] **Step 4: Verify the trigger is still commented and the workflow parses**

```bash
grep -n "workflow_run" .github/workflows/deploy.yml   # must show only commented lines
grep -n "environment: production" .github/workflows/deploy.yml  # must return nothing
npx js-yaml .github/workflows/deploy.yml > /dev/null && echo "YAML OK"
```

Expected: `workflow_run` appears only behind `#`; no `environment:` match; `YAML OK`.

- [ ] **Step 5: Verify and commit**

Run: `npm run verify`
Expected: PASS.

```bash
git add vercel.json .github/workflows/deploy.yml
git commit -m "fix(deploy): repo-level secrets, session pooler, fra1 region"
```

---

### Task 3: Cloudflare Worker cron for the reminder drain

**Files:**
- Create: `workers/cron/src/index.ts`
- Create: `workers/cron/wrangler.toml`
- Create: `workers/cron/src/index.test.ts`
- Modify: `vitest.config.ts` (add `workers/**/*.test.ts` to `include`)

**Interfaces:**
- Consumes: `SCHEDULING_DRAIN_SECRET` (same value as the Vercel env), the drain endpoint at `/api/scheduling/drain`.
- Produces: `type WorkerEnv = { DRAIN_URL: string; SCHEDULING_DRAIN_SECRET: string; HEALTHCHECK_URL: string }`, `drainRequest(env: WorkerEnv): Request`, `runDrain(env: WorkerEnv, fetchImpl?: typeof fetch): Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

Create `workers/cron/src/index.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { drainRequest, runDrain, type WorkerEnv } from "./index";

const ENV: WorkerEnv = {
  DRAIN_URL: "https://booklo.co/api/scheduling/drain",
  SCHEDULING_DRAIN_SECRET: "0123456789abcdef0123",
  HEALTHCHECK_URL: "https://hc-ping.com/abc",
};

describe("drainRequest", () => {
  it("POSTs to the drain url with a bearer token", () => {
    const req = drainRequest(ENV);
    expect(req.method).toBe("POST");
    expect(req.url).toBe(ENV.DRAIN_URL);
    expect(req.headers.get("authorization")).toBe(`Bearer ${ENV.SCHEDULING_DRAIN_SECRET}`);
  });
});

describe("runDrain", () => {
  it("pings the healthcheck after a successful drain", async () => {
    const calls: string[] = [];
    const fake = vi.fn(async (input: Request | string) => {
      calls.push(typeof input === "string" ? input : input.url);
      return new Response("{}", { status: 200 });
    });
    await expect(runDrain(ENV, fake as unknown as typeof fetch)).resolves.toBe(true);
    expect(calls).toEqual([ENV.DRAIN_URL, ENV.HEALTHCHECK_URL]);
  });

  // The healthcheck is the alarm. Pinging it on a failed drain would report
  // health while reminders silently stop — and the drain's traffic is also
  // what keeps the Free-tier project from pausing, so a silent failure ends
  // in the whole site going down about a week later.
  it("does NOT ping the healthcheck when the drain fails", async () => {
    const calls: string[] = [];
    const fake = vi.fn(async (input: Request | string) => {
      calls.push(typeof input === "string" ? input : input.url);
      return new Response("nope", { status: 500 });
    });
    await expect(runDrain(ENV, fake as unknown as typeof fetch)).resolves.toBe(false);
    expect(calls).toEqual([ENV.DRAIN_URL]);
  });
});
```

- [ ] **Step 2: Add the workers path to the Vitest include**

In `vitest.config.ts`, change the `include` line to:

```ts
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts", "workers/**/*.test.ts"],
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run workers/cron/src/index.test.ts`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 4: Implement the Worker**

Create `workers/cron/src/index.ts`:

```ts
/* Reminder-drain scheduler (spec 2026-08-19-launch-infrastructure §7).
   Cloudflare Worker cron rather than Vercel Cron (Hobby is once-daily at an
   arbitrary time) or GitHub Actions (a 15-minute tick on a private repo
   exceeds the 2,000 free minutes/month). */

export type WorkerEnv = {
  DRAIN_URL: string;
  SCHEDULING_DRAIN_SECRET: string;
  HEALTHCHECK_URL: string;
};

export function drainRequest(env: WorkerEnv): Request {
  return new Request(env.DRAIN_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SCHEDULING_DRAIN_SECRET}` },
  });
}

/** Returns whether the drain succeeded. The healthcheck is pinged ONLY on
    success: it is the alarm for a dead scheduler, and a dead scheduler also
    stops the database traffic that keeps a Free-tier project from pausing. */
export async function runDrain(env: WorkerEnv, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const response = await fetchImpl(drainRequest(env));
  if (!response.ok) {
    console.error(`[cron] drain failed: ${response.status} ${await response.text()}`);
    return false;
  }
  await fetchImpl(env.HEALTHCHECK_URL);
  return true;
}

/* Minimal local types for the two Cloudflare objects this handler touches.
   Deliberately NOT @cloudflare/workers-types: tsconfig.json includes
   "**/*.ts", so that package's globals would land in the Next app too, where
   they redefine Request/Response/fetch. Two structural types cost nothing and
   keep the blast radius at this file. */
type ScheduledEvent = { scheduledTime: number };
type ExecutionCtx = { waitUntil(promise: Promise<unknown>): void };

export default {
  async scheduled(_event: ScheduledEvent, env: WorkerEnv, ctx: ExecutionCtx) {
    ctx.waitUntil(runDrain(env));
  },
};
```

- [ ] **Step 5: Create the Wrangler config**

Create `workers/cron/wrangler.toml`:

```toml
name = "booklo-cron"
main = "src/index.ts"
compatibility_date = "2026-08-19"

# Every 15 minutes. Reminders have a 24h lead window, so this granularity is
# ample; it also produces ~96 database round trips a day, which is what keeps
# the Supabase Free project from pausing for inactivity.
[triggers]
crons = ["*/15 * * * *"]
```

Secrets are set out-of-band, never committed:

```bash
cd workers/cron
npx wrangler secret put SCHEDULING_DRAIN_SECRET
npx wrangler secret put HEALTHCHECK_URL
npx wrangler secret put DRAIN_URL
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run workers/cron/src/index.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Verify and commit**

Run: `npm run verify`
Expected: PASS. `tsconfig.json` includes `**/*.ts`, so the Worker is type-checked by the app's config — which is why Step 4 declares its two Cloudflare types locally instead of adding a `@cloudflare/workers-types` dependency. No tsconfig change is needed. If you find yourself editing `tsconfig.json` here, stop: something has gone wrong.

```bash
git add workers vitest.config.ts
git commit -m "feat(cron): cloudflare worker drives the reminder drain"
```

---

### Task 4: Encrypted daily backup workflow

**Files:**
- Create: `.github/workflows/backup.yml`

**Interfaces:**
- Consumes: repository secrets `DATABASE_URL` (session pooler) and `BACKUP_PASSPHRASE`.
- Produces: a dated, encrypted dump as a 7-day GitHub artifact.

- [ ] **Step 1: Create the workflow**

```yaml
name: Backup

# Supabase Free has no restorable backups, so this dump is the ONLY restore
# path (spec §10). Daily, so worst-case data loss is 24 hours.
on:
  schedule:
    - cron: "0 3 * * *"
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: backup
  cancel-in-progress: false

jobs:
  dump:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v7

      - uses: supabase/setup-cli@v3
        with:
          version: latest

      # `supabase db dump` ships a version-matched dump binary. Raw pg_dump
      # from ubuntu-latest is client 16 and aborts against our PostgreSQL 17.
      #
      # Schemas: public + auth + storage + drizzle.
      #   auth    — omit it and user accounts are unrestorable.
      #   drizzle — holds __drizzle_migrations, the migration journal. Restore
      #             without it and the next `drizzle-kit migrate` re-runs all
      #             47 migrations against an already-populated database.
      - name: Dump
        run: |
          supabase db dump \
            --db-url "$DATABASE_URL" \
            -s public -s auth -s storage -s drizzle \
            -f dump.sql
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}

      # The dump contains client names and email addresses. An unencrypted
      # artifact would be a PII leak.
      - name: Encrypt
        run: |
          openssl enc -aes-256-cbc -pbkdf2 -iter 600000 \
            -in dump.sql -out "booklo-$(date -u +%Y%m%d).sql.enc" \
            -pass env:BACKUP_PASSPHRASE
          rm dump.sql
        env:
          BACKUP_PASSPHRASE: ${{ secrets.BACKUP_PASSPHRASE }}

      # GitHub Free allows 500MB of artifact storage in total, with a 90-day
      # default retention that daily dumps would quietly exhaust.
      - uses: actions/upload-artifact@v4
        with:
          name: booklo-backup-${{ github.run_id }}
          path: "*.sql.enc"
          retention-days: 7
```

- [ ] **Step 2: Verify the workflow parses**

```bash
npx js-yaml .github/workflows/backup.yml > /dev/null && echo "YAML OK"
```

Expected: `YAML OK`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/backup.yml
git commit -m "feat(backup): daily encrypted supabase dump"
```

The first real run happens after cutover step 1 provides `DATABASE_URL`; verify it then with `workflow_dispatch`, and confirm the decrypt path before trusting it:
`openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in <file>.sql.enc -pass env:BACKUP_PASSPHRASE | head`

---

### Task 5: Supabase production config block

**Files:**
- Modify: `supabase/config.toml` (append at end of file)

**Interfaces:**
- Consumes: `RESEND_API_KEY` exported in the shell that runs `config push`.
- Produces: a `[remotes.production]` override applied by `supabase config push --project-ref <ref> --yes`.

- [ ] **Step 1: Append the override block**

```toml
# ─── Production overrides (spec 2026-08-19-launch-infrastructure §6) ──────────
# Applied by: supabase config push --project-ref <ref> --yes
#
# WARNING: if project_id below does not match --project-ref, the CLI SILENTLY
# skips this whole block and pushes the base config instead — localhost
# site_url, email_sent = 2, no SMTP — with no error and a zero exit code.
# scripts/setup-production.ts asserts the match before pushing and asserts
# "Loading config override" appears in the output.
#
# The placeholder below is deliberately invalid so that assertion fires until
# the real ref is filled in (cutover step 2).
[remotes.production]
project_id = "REPLACE_WITH_PROD_REF"

[remotes.production.auth]
site_url = "https://booklo.co"
additional_redirect_urls = ["https://booklo.co", "https://booklo.co/auth/confirm"]

# The base config sets email_sent = 2 for local development. Pushed as-is,
# the THIRD signup in any hour would silently never receive its confirmation.
# Note this key is only pushed when smtp.enabled is true in the same effective
# config — which the block below satisfies.
[remotes.production.auth.rate_limit]
email_sent = 30

# Without custom SMTP, Supabase Auth refuses to deliver to any address outside
# the project team: nobody but the owner could sign up. This is the hardest
# launch blocker in the spec, not a nicety.
[remotes.production.auth.email.smtp]
enabled = true
host = "smtp.resend.com"
port = 465
user = "resend"
pass = "env(RESEND_API_KEY)"
admin_email = "support@booklo.co"
sender_name = "Booklo"
```

- [ ] **Step 2: Verify the file still parses and local development is unaffected**

```bash
supabase stop 2>/dev/null; supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor
```

Expected: starts cleanly. A malformed key fails loudly, e.g. `'remotes[production].auth' has invalid keys: ...`. Confirm the local stack still uses `http://localhost:3000` — the override applies only when `--project-ref` matches.

- [ ] **Step 3: Commit**

```bash
git add supabase/config.toml
git commit -m "feat(supabase): production config override block"
```

---

### Task 6: Provisioning wizard and operator runbook

**Files:**
- Create: `scripts/setup-production.ts`
- Create: `scripts/setup-production.test.ts`
- Create: `docs/runbook-production.md`

**Interfaces:**
- Consumes: `envSchema` is NOT used here (the wizard checks a remote, not this process). Requires `SUPABASE_ACCESS_TOKEN`, `RESEND_API_KEY`, `SCHEDULING_DRAIN_SECRET`, `DATABASE_URL` (session pooler) exported in the operator's shell.
- Produces: `type CheckResult = { name: string; ok: boolean; detail: string }`, and the pure predicates `configHasRemoteRef(toml: string, ref: string): boolean`, `pushAppliedOverride(output: string): boolean`, `migrationsMatch(applied: number, journalEntries: number): boolean`.

The wizard checks only the failures that are **silent**. Loud failures (a 500 page, a wrong region) are not worth scripting.

- [ ] **Step 1: Write the failing test**

Create `scripts/setup-production.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { configHasRemoteRef, migrationsMatch, pushAppliedOverride } from "./setup-production";

describe("configHasRemoteRef", () => {
  const toml = `
[remotes.production]
project_id = "abcdefghijklmnop"
`;

  it("accepts a ref that matches a remotes project_id", () => {
    expect(configHasRemoteRef(toml, "abcdefghijklmnop")).toBe(true);
  });

  // The trap this whole check exists for: a mismatch makes `config push`
  // silently apply the BASE config (localhost site_url, no SMTP,
  // email_sent = 2) and exit 0.
  it("rejects a ref that does not match", () => {
    expect(configHasRemoteRef(toml, "zzzzzzzzzzzzzzzz")).toBe(false);
  });

  it("rejects the committed placeholder", () => {
    expect(configHasRemoteRef(`[remotes.production]\nproject_id = "REPLACE_WITH_PROD_REF"\n`, "abcdefghijklmnop")).toBe(false);
  });
});

describe("pushAppliedOverride", () => {
  it("detects the override banner", () => {
    expect(pushAppliedOverride("Loading config override: [remotes.production]\nFinished")).toBe(true);
  });

  it("rejects output without it", () => {
    expect(pushAppliedOverride("Finished supabase config push.")).toBe(false);
  });
});

describe("migrationsMatch", () => {
  it("passes when applied equals the journal", () => {
    expect(migrationsMatch(47, 47)).toBe(true);
  });

  // Deliberately not "0046 exists": the journal is already at 47 entries and
  // the parked R3 work will renumber.
  it("fails when the remote is behind", () => {
    expect(migrationsMatch(46, 47)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run scripts/setup-production.test.ts`
Expected: FAIL — cannot resolve `./setup-production`.

- [ ] **Step 3: Implement the wizard**

Create `scripts/setup-production.ts`:

```ts
import { loadEnvFile } from "node:process";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

try {
  loadEnvFile(".env.local");
} catch {
  // env may be exported directly
}

const REF = process.env.PROD_PROJECT_REF ?? "";
const APP_URL = "https://booklo.co";
const SEND_DOMAIN = "mail.booklo.co";

export type CheckResult = { name: string; ok: boolean; detail: string };

/** True when `ref` appears as a project_id under any [remotes.*] table. */
export function configHasRemoteRef(toml: string, ref: string): boolean {
  if (!ref) return false;
  const remotes = toml.split(/^\[remotes\./m).slice(1);
  return remotes.some((block) => new RegExp(`project_id\\s*=\\s*"${ref}"`).test(block));
}

/** The CLI prints this only when it actually applied the override. */
export function pushAppliedOverride(output: string): boolean {
  return output.includes("Loading config override");
}

export function migrationsMatch(applied: number, journalEntries: number): boolean {
  return applied === journalEntries && journalEntries > 0;
}

function journalEntryCount(): number {
  const journal = JSON.parse(readFileSync("src/db/migrations/meta/_journal.json", "utf8")) as {
    entries: unknown[];
  };
  return journal.entries.length;
}

async function checkCredentials(): Promise<CheckResult> {
  const missing = ["SUPABASE_ACCESS_TOKEN", "RESEND_API_KEY", "SCHEDULING_DRAIN_SECRET", "DATABASE_URL"]
    .filter((k) => !process.env[k]);
  if (!REF) missing.push("PROD_PROJECT_REF");
  return {
    name: "credentials exported",
    ok: missing.length === 0,
    detail: missing.length ? `missing: ${missing.join(", ")}` : "all present",
  };
}

async function checkRemoteRef(): Promise<CheckResult> {
  const ok = configHasRemoteRef(readFileSync("supabase/config.toml", "utf8"), REF);
  return {
    name: "config.toml carries the production ref",
    ok,
    detail: ok
      ? `[remotes.*].project_id = ${REF}`
      : `no [remotes.*] block has project_id = "${REF}" — push would SILENTLY apply the base config`,
  };
}

async function checkSiteUrl(): Promise<CheckResult> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, {
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` },
  });
  if (!res.ok) return { name: "remote site_url", ok: false, detail: `management api ${res.status}` };
  const body = (await res.json()) as { site_url?: string };
  return {
    name: "remote site_url",
    ok: body.site_url === APP_URL,
    detail: `site_url = ${body.site_url ?? "(unset)"}`,
  };
}

async function checkResendDomain(): Promise<CheckResult> {
  const res = await fetch("https://api.resend.com/domains", {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
  });
  if (!res.ok) return { name: "resend domain verified", ok: false, detail: `resend api ${res.status}` };
  const body = (await res.json()) as { data?: Array<{ name: string; status: string }> };
  const domain = body.data?.find((d) => d.name === SEND_DOMAIN);
  return {
    name: "resend domain verified",
    ok: domain?.status === "verified",
    detail: domain ? `${domain.name}: ${domain.status}` : `${SEND_DOMAIN} not found`,
  };
}

async function checkMigrations(): Promise<CheckResult> {
  const applied = Number(
    execFileSync(
      "psql",
      [process.env.DATABASE_URL ?? "", "-tAc", "select count(*) from drizzle.__drizzle_migrations"],
      { encoding: "utf8" },
    ).trim(),
  );
  const expected = journalEntryCount();
  return {
    name: "migrations applied",
    ok: migrationsMatch(applied, expected),
    detail: `${applied} applied / ${expected} in journal`,
  };
}

async function checkDrainAuth(): Promise<CheckResult> {
  const url = `${APP_URL}/api/scheduling/drain`;
  // NOTE: the authorised call runs a REAL drain tick. Harmless, not a dry run.
  const good = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.SCHEDULING_DRAIN_SECRET}` },
  });
  const bad = await fetch(url, { method: "POST", headers: { Authorization: "Bearer wrong" } });
  return {
    name: "drain auth",
    ok: good.status === 200 && bad.status === 401,
    detail: `valid=${good.status} invalid=${bad.status} (expected 200/401)`,
  };
}

const CHECKS = [
  checkCredentials,
  checkRemoteRef,
  checkSiteUrl,
  checkResendDomain,
  checkMigrations,
  checkDrainAuth,
];

async function main() {
  console.log(`Booklo production readiness — project ${REF || "(PROD_PROJECT_REF unset)"}\n`);
  let failed = 0;
  for (const check of CHECKS) {
    let result: CheckResult;
    try {
      result = await check();
    } catch (error) {
      result = { name: check.name, ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
    console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.name} — ${result.detail}`);
    if (!result.ok) failed++;
  }
  console.log(`\n${CHECKS.length - failed}/${CHECKS.length} passed`);
  process.exit(failed === 0 ? 0 : 1);
}

if (process.argv[1]?.endsWith("setup-production.ts")) {
  void main();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run scripts/setup-production.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Write the operator runbook**

Create `docs/runbook-production.md` covering, each as a copy-pasteable command block:

1. **Run the readiness check** — `PROD_PROJECT_REF=<ref> npx tsx scripts/setup-production.ts`, with the four required exports listed.
2. **Apply Supabase config** — `RESEND_API_KEY=... supabase config push --project-ref <ref> --yes`; confirm `Loading config override` in the output; review the full diff, because push covers API, database and storage settings, not only auth.
3. **Migrate production** — `DATABASE_URL='<session pooler :5432>' npx drizzle-kit migrate`. State plainly that a bare `npx drizzle-kit migrate` migrates the **local** stack, because `drizzle.config.ts` calls `loadEnvFile(".env.local")` and an exported shell variable takes precedence over it.
4. **Restore a backup** — decrypt with `openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000`, then restore. Note that `auth` and `storage` DDL is owned by `supabase_auth_admin` / `supabase_storage_admin`, so a restore into a fresh project is **data-only** for those two schemas.
5. **Un-pause a paused project** — dashboard action; note that the cause is almost always a dead Worker cron, so check healthchecks.io first and redeploy the Worker before assuming a Supabase fault.
6. **Roll back a deploy** — promote the previous deployment in Vercel. Warn that migrations are **not** rolled back: `deploy.yml` migrates before promoting, so the schema is always at or ahead of the code, and a rollback must be schema-compatible.
7. **Rotate a secret** — the drain secret lives in three places (Vercel env, Wrangler secret, and the operator shell); rotate all three together or the drain 401s.

- [ ] **Step 6: Verify and commit**

Run: `npm run verify`
Expected: PASS.

```bash
git add scripts/setup-production.ts scripts/setup-production.test.ts docs/runbook-production.md
git commit -m "feat(infra): production readiness wizard and operator runbook"
```

---

## After this plan

The repo is ready; the environment does not exist yet. Execute spec §11 (cutover) in order — it is operator work, not agent work. The wizard (`scripts/setup-production.ts`) is the gate at each stage, and spec §12 (smoke test) is the final acceptance, run **from an address that is not the owner's**, since the custom-SMTP failure mode is invisible to the account owner.

Two follow-up PRs, both deliberately out of this plan:

1. The one-line PR uncommenting the `workflow_run` trigger in `deploy.yml` (cutover step 14).
2. The `/pricing` + `/contact` marketing slice, required before the Stripe Managed Payments application.
