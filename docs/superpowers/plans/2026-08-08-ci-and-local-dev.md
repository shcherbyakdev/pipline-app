# CI Pipeline & Local Dev Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `npm run dev` work on a fresh clone with no tribal knowledge, and gate every PR on lint, types, tests, production build, and database-migration integrity.

**Architecture:** A single idempotent preflight script (`scripts/dev-preflight.ts`) runs as npm's `predev` hook and brings up Docker → Supabase → `.env.local` → migrations, failing with an actionable remedy at whichever step breaks. Its parsing and env-merge logic lives in pure, unit-tested modules under `scripts/lib/`. CI is six parallel GitHub Actions jobs behind one aggregator status; deploy is a separate `workflow_run`-triggered workflow that migrates production before promoting to Vercel.

**Tech Stack:** Node 24, Next.js 16, Supabase CLI 2.x, Drizzle Kit 0.31, Vitest 4, GitHub Actions, Vercel CLI.

## Global Constraints

- Node version is pinned to `24` in `.nvmrc`; CI reads it via `node-version-file`, never a hardcoded version.
- Postgres is major version 17 (`supabase/config.toml` `db.major_version`). Do not introduce a `postgres:16` or `postgres:latest` service anywhere.
- Local Supabase ports are offset by +30 and must not be changed: API `54351`, DB `54352`, Studio `54353`, Mailpit `54354`.
- Local database URL is exactly `postgresql://postgres:postgres@127.0.0.1:54352/postgres`.
- The preflight must **never overwrite a non-empty value** in `.env.local`. Blank-only fill.
- `SKIP_PREFLIGHT=1` must short-circuit the preflight before any Docker call.
- All workflows declare `permissions: contents: read` at workflow level.
- Migrations applied by `deploy.yml` must be backward compatible with the currently-deployed code (additive only; destructive changes split across two releases).
- Do not add Prettier. Do not add a Dockerfile. Both are explicit non-goals.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `.nvmrc` | Single source of Node version, local and CI |
| `scripts/lib/env-file.ts` | Pure parse/merge of `.env` files and `supabase status -o env` output |
| `scripts/lib/env-file.test.ts` | Unit tests for the above |
| `scripts/lib/preflight-checks.ts` | The four checks, each returning a `CheckResult`; no printing, no `process.exit` |
| `scripts/dev-preflight.ts` | Runner: sequences checks, formats output, owns the exit code |
| `scripts/seed.ts` | Idempotent demo org + user via the Supabase admin API |
| `supabase/seed.sql` | Comment-only no-op that documents why SQL seeding can't work here |
| `.github/actions/setup/action.yml` | Composite: checkout + setup-node + `npm ci` |
| `.github/workflows/ci.yml` | lint, typecheck, test, build, db, aggregator |
| `.github/workflows/deploy.yml` | Migrate production, then deploy to Vercel |
| `.github/dependabot.yml` | Weekly npm + github-actions updates |

**Modified:**

| Path | Change |
|---|---|
| `package.json` | New scripts: `setup`, `predev`, `typecheck`, `verify`, `db:reset`, `db:seed`, `supabase:*` |
| `vitest.config.ts` | Widen `include` to cover `scripts/**/*.test.ts` |
| `.env.example` | Document local Supabase defaults as comments |
| `README.md` | Rewrite Getting started; add ports + troubleshooting tables |

Boundary rationale: `env-file.ts` is pure string-in/string-out and carries all the tests. `preflight-checks.ts` holds the side effects but returns data rather than printing, so a check can be reasoned about in isolation. `dev-preflight.ts` is the only file that writes to stdout or sets an exit code.

---

## Task 1: Node pin, typecheck, and test-path widening

Groundwork every later task depends on. Small, but it's the task that makes `npm run typecheck` and `npm run verify` exist — and Task 2 needs Vitest to actually collect `scripts/**` tests, which it currently does not.

**Files:**
- Create: `.nvmrc`
- Modify: `package.json` (scripts block)
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run typecheck` → `tsc --noEmit`; `npm run verify` → lint + typecheck + test. Vitest collects `scripts/**/*.test.ts`.

- [ ] **Step 1: Pin the Node version**

Create `.nvmrc`:

```
24
```

- [ ] **Step 2: Widen the Vitest include glob**

The current config only collects `src/**/*.test.ts`, so the tests written in Task 2 would silently never run. Replace `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Add the `typecheck` and `verify` scripts**

In `package.json`, inside `"scripts"`, add these two entries (leave every existing entry as-is):

```json
    "typecheck": "tsc --noEmit",
    "verify": "npm run lint && npm run typecheck && npm run test",
```

- [ ] **Step 4: Verify all three work**

```bash
npm run typecheck
npm run test
npm run verify
```

Expected: `typecheck` exits 0. `test` reports the existing `src/lib/status.test.ts` passing. `verify` runs all three in sequence and exits 0.

If `typecheck` reports pre-existing errors, stop and report them — do not fix unrelated type errors inside this task.

- [ ] **Step 5: Commit**

```bash
git add .nvmrc vitest.config.ts package.json
git commit -m "chore: pin node 24, add typecheck/verify scripts, widen vitest include"
```

---

## Task 2: Env-file parsing and merging (pure logic, TDD)

The riskiest logic in the whole plan, and the only part that can genuinely destroy user data — an overwrite bug here silently repoints a developer from their remote Supabase project to localhost. So it is pure, and it is tested first.

`supabase status -o env` emits `KEY="value"` lines interleaved with noise: a `Stopped services: [...]` line and a multi-line CLI-upgrade notice. The parser must ignore anything that isn't a well-formed assignment.

**Files:**
- Create: `scripts/lib/env-file.ts`
- Test: `scripts/lib/env-file.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, for Task 3:
  - `parseEnvFile(contents: string): Record<string, string>`
  - `parseSupabaseStatusEnv(stdout: string): Record<string, string>`
  - `supabaseEnvToAppEnv(status: Record<string, string>): Record<string, string>`
  - `fillBlankEnvValues(contents: string, values: Record<string, string>): { contents: string; filled: string[] }`

- [ ] **Step 1: Write the failing tests**

Create `scripts/lib/env-file.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseEnvFile,
  parseSupabaseStatusEnv,
  supabaseEnvToAppEnv,
  fillBlankEnvValues,
} from "./env-file";

describe("parseEnvFile", () => {
  it("reads bare and quoted values, skipping comments and blanks", () => {
    const contents = [
      "# a comment",
      "",
      "BARE=hello",
      'QUOTED="world"',
      "SINGLE='quoted'",
      "  SPACED  =  padded  ",
    ].join("\n");

    expect(parseEnvFile(contents)).toEqual({
      BARE: "hello",
      QUOTED: "world",
      SINGLE: "quoted",
      SPACED: "padded",
    });
  });

  it("keeps '=' that appear inside the value", () => {
    expect(parseEnvFile("DATABASE_URL=postgres://u:p@h/db?a=1&b=2")).toEqual({
      DATABASE_URL: "postgres://u:p@h/db?a=1&b=2",
    });
  });

  it("records a declared-but-empty key as an empty string", () => {
    expect(parseEnvFile("DATABASE_URL=")).toEqual({ DATABASE_URL: "" });
  });
});

describe("parseSupabaseStatusEnv", () => {
  it("ignores non-assignment noise lines from the CLI", () => {
    const stdout = [
      "Stopped services: [supabase_imgproxy_pipline-app supabase_pooler_pipline-app]",
      'API_URL="http://127.0.0.1:54351"',
      'ANON_KEY="anon-key-value"',
      'DB_URL="postgresql://postgres:postgres@127.0.0.1:54352/postgres"',
      "A new version of Supabase CLI is available: v2.113.0 (currently installed v2.75.0)",
      "We recommend updating regularly for new features and bug fixes: https://example.com",
    ].join("\n");

    expect(parseSupabaseStatusEnv(stdout)).toEqual({
      API_URL: "http://127.0.0.1:54351",
      ANON_KEY: "anon-key-value",
      DB_URL: "postgresql://postgres:postgres@127.0.0.1:54352/postgres",
    });
  });
});

describe("supabaseEnvToAppEnv", () => {
  it("maps CLI keys onto the app's env var names", () => {
    const mapped = supabaseEnvToAppEnv({
      API_URL: "http://127.0.0.1:54351",
      ANON_KEY: "anon",
      SERVICE_ROLE_KEY: "service",
      DB_URL: "postgresql://postgres:postgres@127.0.0.1:54352/postgres",
      STUDIO_URL: "http://127.0.0.1:54353",
    });

    expect(mapped).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54351",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54352/postgres",
    });
  });

  it("omits keys the CLI did not report", () => {
    expect(supabaseEnvToAppEnv({ API_URL: "http://127.0.0.1:54351" })).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54351",
    });
  });
});

describe("fillBlankEnvValues", () => {
  it("fills a declared-but-blank key in place", () => {
    const result = fillBlankEnvValues("DATABASE_URL=\n", { DATABASE_URL: "postgres://local" });

    expect(result.contents).toBe("DATABASE_URL=postgres://local\n");
    expect(result.filled).toEqual(["DATABASE_URL"]);
  });

  it("NEVER overwrites a non-empty existing value", () => {
    const contents = "DATABASE_URL=postgres://remote-production\n";
    const result = fillBlankEnvValues(contents, { DATABASE_URL: "postgres://local" });

    expect(result.contents).toBe(contents);
    expect(result.filled).toEqual([]);
  });

  it("appends keys absent from the file", () => {
    const result = fillBlankEnvValues("EXISTING=kept\n", { NEW_KEY: "added" });

    expect(result.contents).toBe("EXISTING=kept\nNEW_KEY=added\n");
    expect(result.filled).toEqual(["NEW_KEY"]);
  });

  it("preserves comments, blank lines, and original ordering", () => {
    const contents = ["# --- Supabase ---", "NEXT_PUBLIC_SUPABASE_URL=", "", "# --- App ---", "OTHER=keep"].join("\n");
    const result = fillBlankEnvValues(contents, { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54351" });

    expect(result.contents).toBe(
      ["# --- Supabase ---", "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54351", "", "# --- App ---", "OTHER=keep", ""].join("\n"),
    );
    expect(result.filled).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
  });

  it("returns an empty filled list when there is nothing to do", () => {
    const result = fillBlankEnvValues("A=1\n", { A: "2" });
    expect(result.filled).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
npx vitest run scripts/lib/env-file.test.ts
```

Expected: FAIL — `Failed to resolve import "./env-file"`.

- [ ] **Step 3: Write the implementation**

Create `scripts/lib/env-file.ts`:

```ts
/**
 * Pure parsing/merging for `.env` files and `supabase status -o env` output.
 * No filesystem access, no process access — everything here is string in,
 * string out, so the overwrite guarantee in `fillBlankEnvValues` is testable.
 */

// KEY=value, tolerating surrounding whitespace. Value runs to end of line so
// connection strings keep their own `=` characters.
const ASSIGNMENT = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

function unquote(raw: string): string {
  const value = raw.trim();
  const quoted =
    (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
  return quoted && value.length >= 2 ? value.slice(1, -1) : value;
}

export function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of contents.split("\n")) {
    if (line.trim().startsWith("#")) continue;
    const match = ASSIGNMENT.exec(line);
    if (match) out[match[1]] = unquote(match[2]);
  }
  return out;
}

/**
 * `supabase status -o env` interleaves assignments with human-readable noise
 * ("Stopped services: [...]", CLI upgrade notices). Only well-formed
 * SCREAMING_SNAKE assignments are accepted; everything else is dropped.
 */
export function parseSupabaseStatusEnv(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const match = /^([A-Z][A-Z0-9_]*)="(.*)"\s*$/.exec(line.trim());
    if (match) out[match[1]] = match[2];
  }
  return out;
}

const SUPABASE_TO_APP: Record<string, string> = {
  API_URL: "NEXT_PUBLIC_SUPABASE_URL",
  ANON_KEY: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  SERVICE_ROLE_KEY: "SUPABASE_SERVICE_ROLE_KEY",
  DB_URL: "DATABASE_URL",
};

export function supabaseEnvToAppEnv(status: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [from, to] of Object.entries(SUPABASE_TO_APP)) {
    if (status[from]) out[to] = status[from];
  }
  return out;
}

/**
 * Fill blank keys from `values`, leaving every non-empty value untouched.
 * A developer pointed at a remote Supabase project must never be silently
 * redirected to localhost — that is the one hard rule of this function.
 */
export function fillBlankEnvValues(
  contents: string,
  values: Record<string, string>,
): { contents: string; filled: string[] } {
  const filled: string[] = [];
  const seen = new Set<string>();

  const lines = contents.split("\n").map((line) => {
    if (line.trim().startsWith("#")) return line;
    const match = ASSIGNMENT.exec(line);
    if (!match) return line;

    const [, key, rawValue] = match;
    seen.add(key);
    if (unquote(rawValue) !== "" || !values[key]) return line;

    filled.push(key);
    return `${key}=${values[key]}`;
  });

  // Drop a single trailing empty line so appends and the final newline below
  // don't compound into a growing run of blank lines on repeat runs.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  for (const [key, value] of Object.entries(values)) {
    if (seen.has(key)) continue;
    filled.push(key);
    lines.push(`${key}=${value}`);
  }

  return { contents: `${lines.join("\n")}\n`, filled };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
npx vitest run scripts/lib/env-file.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/env-file.ts scripts/lib/env-file.test.ts
git commit -m "feat(scripts): env-file parsing and blank-only merge helpers"
```

---

## Task 3: Preflight checks and runner

**Files:**
- Create: `scripts/lib/preflight-checks.ts`
- Create: `scripts/dev-preflight.ts`
- Modify: `package.json` (add `setup`, `predev`)

**Interfaces:**
- Consumes: `parseEnvFile`, `parseSupabaseStatusEnv`, `supabaseEnvToAppEnv`, `fillBlankEnvValues` from `scripts/lib/env-file.ts` (Task 2).
- Produces: `type CheckResult`, `type Check`, and `const checks: Check[]` from `scripts/lib/preflight-checks.ts`. `npm run setup` and the `predev` hook.

- [ ] **Step 1: Write the checks module**

Create `scripts/lib/preflight-checks.ts`:

```ts
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import {
  parseEnvFile,
  parseSupabaseStatusEnv,
  supabaseEnvToAppEnv,
  fillBlankEnvValues,
} from "./env-file";

export type CheckResult =
  | { ok: true; note?: string }
  | { ok: false; reason: string; remedy: string };

export type Check = {
  name: string;
  /** Printed before the check runs when it may block for a long time. */
  slowHint?: string;
  run: () => CheckResult;
};

const ENV_FILE = ".env.local";
const ENV_EXAMPLE = ".env.example";

function run(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function supabaseIsUp(): boolean {
  try {
    // `status` exits non-zero when the stack is down, which is the signal.
    return parseSupabaseStatusEnv(run("supabase", ["status", "-o", "env"])).API_URL !== undefined;
  } catch {
    return false;
  }
}

const dockerRunning: Check = {
  name: "Docker daemon",
  run() {
    try {
      run("docker", ["info"]);
      return { ok: true };
    } catch {
      return {
        ok: false,
        reason: "Docker isn't running (or isn't installed).",
        remedy: "Start Docker Desktop, wait for the whale icon to settle, then re-run `npm run dev`.",
      };
    }
  },
};

const supabaseRunning: Check = {
  name: "Supabase stack",
  slowHint: "First run downloads several container images — this can take a few minutes.",
  run() {
    if (supabaseIsUp()) return { ok: true, note: "already running" };
    try {
      run("supabase", ["start"]);
      return { ok: true, note: "started" };
    } catch (error) {
      return {
        ok: false,
        reason: `\`supabase start\` failed: ${(error as Error).message.split("\n")[0]}`,
        remedy: "Try `npm run supabase:stop && npm run supabase:start`. If a port is in use, check what else is on 54351-54354.",
      };
    }
  },
};

const envLocalPopulated: Check = {
  name: ".env.local",
  run() {
    if (!existsSync(ENV_FILE)) {
      if (!existsSync(ENV_EXAMPLE)) {
        return {
          ok: false,
          reason: `Neither ${ENV_FILE} nor ${ENV_EXAMPLE} exists.`,
          remedy: `Restore ${ENV_EXAMPLE} from git: \`git checkout ${ENV_EXAMPLE}\`.`,
        };
      }
      copyFileSync(ENV_EXAMPLE, ENV_FILE);
    }

    let statusEnv: Record<string, string>;
    try {
      statusEnv = parseSupabaseStatusEnv(run("supabase", ["status", "-o", "env"]));
    } catch (error) {
      return {
        ok: false,
        reason: `Could not read Supabase credentials: ${(error as Error).message.split("\n")[0]}`,
        remedy: "Run `npm run supabase:status` to see what the CLI reports.",
      };
    }

    const { contents, filled } = fillBlankEnvValues(
      readFileSync(ENV_FILE, "utf8"),
      supabaseEnvToAppEnv(statusEnv),
    );
    if (filled.length > 0) writeFileSync(ENV_FILE, contents);

    const missing = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "DATABASE_URL"].filter(
      (key) => !parseEnvFile(contents)[key],
    );
    if (missing.length > 0) {
      return {
        ok: false,
        reason: `${ENV_FILE} is missing values for: ${missing.join(", ")}.`,
        remedy: `Fill them in by hand, or delete ${ENV_FILE} and re-run to regenerate from local Supabase.`,
      };
    }

    return { ok: true, note: filled.length > 0 ? `filled ${filled.join(", ")}` : "already populated" };
  },
};

const migrationsApplied: Check = {
  name: "Database migrations",
  run() {
    try {
      run("npx", ["drizzle-kit", "migrate"]);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: `\`drizzle-kit migrate\` failed: ${(error as Error).message.split("\n")[0]}`,
        remedy: "Run `npm run db:reset` to rebuild the local database from scratch.",
      };
    }
  },
};

export const checks: Check[] = [dockerRunning, supabaseRunning, envLocalPopulated, migrationsApplied];
```

- [ ] **Step 2: Write the runner**

Create `scripts/dev-preflight.ts`:

```ts
/**
 * Idempotent local-dev bootstrap. Runs as npm's `predev` hook and as
 * `npm run setup`. Roughly a second when everything is already up.
 *
 * Escape hatch: SKIP_PREFLIGHT=1 npm run dev
 */
import { checks } from "./lib/preflight-checks";

if (process.env.SKIP_PREFLIGHT === "1") {
  console.log("preflight: skipped (SKIP_PREFLIGHT=1)");
  process.exit(0);
}

for (const check of checks) {
  if (check.slowHint) console.log(`  … ${check.name}: ${check.slowHint}`);

  const result = check.run();
  if (result.ok) {
    console.log(`  ✓ ${check.name}${result.note ? ` (${result.note})` : ""}`);
    continue;
  }

  console.error(`\n  ✗ ${check.name}\n`);
  console.error(`    ${result.reason}`);
  console.error(`    → ${result.remedy}\n`);
  process.exit(1);
}

console.log("  ✓ ready — http://localhost:3000\n");
```

- [ ] **Step 3: Add the npm scripts**

In `package.json`, inside `"scripts"`, add:

```json
    "setup": "tsx scripts/dev-preflight.ts",
    "predev": "tsx scripts/dev-preflight.ts",
    "supabase:start": "supabase start",
    "supabase:stop": "supabase stop",
    "supabase:status": "supabase status",
```

- [ ] **Step 4: Verify the happy path (everything already up)**

```bash
npm run setup
```

Expected: four `✓` lines then `✓ ready`, in under ~5 seconds. Exit code 0.

- [ ] **Step 5: Verify idempotence**

```bash
npm run setup && npm run setup && git diff --stat .env.local
```

Expected: both runs succeed identically. `.env.local` is gitignored so `git diff` prints nothing — instead confirm by hand that the file did not grow trailing blank lines between runs.

- [ ] **Step 6: Verify the overwrite guarantee — the critical test**

```bash
cp .env.local /tmp/env.local.backup
sed -i '' 's|^DATABASE_URL=.*|DATABASE_URL=postgres://sentinel-do-not-touch|' .env.local
npm run setup
grep '^DATABASE_URL=' .env.local
cp /tmp/env.local.backup .env.local
```

Expected: the `grep` still prints `DATABASE_URL=postgres://sentinel-do-not-touch`. If preflight replaced it, the merge logic is broken — stop and fix Task 2.

- [ ] **Step 7: Verify regeneration from scratch**

```bash
mv .env.local /tmp/env.local.backup2
npm run setup
grep -c '^NEXT_PUBLIC_SUPABASE_URL=http' .env.local
```

Expected: `.env.local` is recreated from `.env.example` and the grep prints `1`.

- [ ] **Step 8: Verify the escape hatch**

```bash
SKIP_PREFLIGHT=1 npm run setup
```

Expected: prints `preflight: skipped (SKIP_PREFLIGHT=1)`, exits 0 immediately, makes no Docker call.

- [ ] **Step 9: Verify the Docker-down failure path**

Quit Docker Desktop, then:

```bash
npm run setup; echo "exit=$?"
```

Expected: `✗ Docker daemon`, the reason, the `→` remedy, and `exit=1`. Restart Docker afterward.

- [ ] **Step 10: Commit**

```bash
npm run verify
git add scripts/lib/preflight-checks.ts scripts/dev-preflight.ts package.json
git commit -m "feat(dx): preflight bootstrap for npm run dev"
```

---

## Task 4: Seeding

`supabase db reset` runs `seed.sql` *before* Drizzle has created any tables, so SQL seeding cannot reference `public.orgs`. Real seeding happens in TypeScript after `db:migrate`, using the same admin-API pattern as the existing `scripts/verify-foundation.ts`, and going through the `create_org` RPC so the org and the owner membership are created atomically under RLS.

**Files:**
- Create: `scripts/seed.ts`
- Create: `supabase/seed.sql`
- Modify: `package.json` (add `db:seed`, `db:reset`)

**Interfaces:**
- Consumes: the `create_org(p_name text)` RPC from `src/db/migrations/0001_foundation_rls.sql`.
- Produces: `npm run db:seed`, `npm run db:reset`. Demo credentials `demo@rolloutos.local` / `Password123!`.

- [ ] **Step 1: Write the no-op seed.sql**

`supabase/config.toml` already points `db.seed.sql_paths` at `./seed.sql`, but the file is missing. Create `supabase/seed.sql`:

```sql
-- Intentionally empty.
--
-- `supabase db reset` runs this file immediately after applying migrations
-- from supabase/migrations/ — but this project's migrations are owned by
-- Drizzle and live in src/db/migrations/, which the CLI does not read. At the
-- moment this file executes, public.orgs does not exist yet, so any seed
-- statement referencing application tables would fail.
--
-- Demo data is seeded afterwards by scripts/seed.ts. Use:
--
--   npm run db:reset   # supabase db reset -> db:migrate -> db:seed
```

- [ ] **Step 2: Write the seed script**

Create `scripts/seed.ts`:

```ts
/**
 * Idempotent demo data for local development.
 * Run: npm run db:seed  (or npm run db:reset for a clean slate)
 *
 * Goes through the create_org RPC rather than inserting directly, so the org
 * and the caller's owner membership are created the same way onboarding does.
 */
import { loadEnvFile } from "node:process";
import { createClient } from "@supabase/supabase-js";

try {
  loadEnvFile(".env.local");
} catch {
  // Already-exported env (CI) is fine.
}

const DEMO_EMAIL = "demo@rolloutos.local";
const DEMO_PASSWORD = "Password123!";
const DEMO_ORG = "Demo Rollouts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error("seed: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and");
  console.error("      SUPABASE_SERVICE_ROLE_KEY must be set. Run `npm run setup` first.");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function ensureDemoUser(): Promise<void> {
  const { error } = await admin.auth.admin.createUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    email_confirm: true,
  });
  // Re-running the seed is expected; an existing user is not a failure.
  if (error && !/already been registered|already exists/i.test(error.message)) throw error;
}

async function main(): Promise<void> {
  await ensureDemoUser();

  const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  });
  if (signInError) throw signInError;

  // RLS scopes this select to the demo user's own orgs.
  const { data: existing, error: selectError } = await client.from("orgs").select("id, name");
  if (selectError) throw selectError;

  if (existing && existing.length > 0) {
    console.log(`seed: ${DEMO_EMAIL} already owns "${existing[0].name}" — nothing to do`);
    return;
  }

  const { error: rpcError } = await client.rpc("create_org", { p_name: DEMO_ORG });
  if (rpcError) throw rpcError;

  console.log(`seed: created "${DEMO_ORG}"`);
  console.log(`seed: sign in as ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main().catch((error: unknown) => {
  console.error("seed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
```

- [ ] **Step 3: Add the npm scripts**

In `package.json`, inside `"scripts"`, add:

```json
    "db:seed": "tsx scripts/seed.ts",
    "db:reset": "supabase db reset && npm run db:migrate && npm run db:seed",
```

- [ ] **Step 4: Verify a full reset**

```bash
npm run db:reset
```

Expected: `supabase db reset` completes without complaining about a missing `seed.sql`; `drizzle-kit migrate` applies both migrations; the seed prints `seed: created "Demo Rollouts"` and the credentials.

- [ ] **Step 5: Verify seed idempotence**

```bash
npm run db:seed
```

Expected: `seed: demo@rolloutos.local already owns "Demo Rollouts" — nothing to do`. Exit 0, no duplicate org.

- [ ] **Step 6: Commit**

```bash
npm run verify
git add scripts/seed.ts supabase/seed.sql package.json
git commit -m "feat(dx): idempotent demo seed and db:reset"
```

---

## Task 5: CI — setup action and the fast jobs

**Files:**
- Create: `.github/actions/setup/action.yml`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `.nvmrc` (Task 1); `npm run typecheck` (Task 1).
- Produces: a workflow named `CI` with jobs `lint`, `typecheck`, `test`, `build`, and the aggregator `ci`. Task 6 adds a `db` job to this same file and to the aggregator's `needs`.

- [ ] **Step 1: Write the composite setup action**

Create `.github/actions/setup/action.yml`:

```yaml
name: Setup
description: Check out the repo, install the pinned Node version, and install dependencies.

runs:
  using: composite
  steps:
    - uses: actions/checkout@v4

    - uses: actions/setup-node@v4
      with:
        node-version-file: .nvmrc
        cache: npm

    - run: npm ci
      shell: bash
```

- [ ] **Step 2: Write the workflow with the fast jobs**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup
      - run: npm run lint

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup
      - run: npm run typecheck

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup
      - run: npm run test

  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup

      # Per the Next.js CI build-caching guide. Keyed on the lockfile plus a
      # hash of the sources, so a source-only change still reuses the cache.
      - uses: actions/cache@v4
        with:
          path: .next/cache
          key: nextjs-${{ runner.os }}-${{ hashFiles('package-lock.json') }}-${{ hashFiles('src/**/*.[jt]s', 'src/**/*.[jt]sx') }}
          restore-keys: |
            nextjs-${{ runner.os }}-${{ hashFiles('package-lock.json') }}-

      # Placeholder values: src/env.ts validates these at build time, and they
      # are inlined into a bundle that this job discards. Nothing is secret.
      - run: npm run build
        env:
          NEXT_PUBLIC_SUPABASE_URL: http://127.0.0.1:54351
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ci-placeholder-anon-key
          NEXT_PUBLIC_APP_URL: http://localhost:3000

  ci:
    # Single required status for branch protection: adding a job above never
    # requires editing the protection rule.
    if: always()
    needs: [lint, typecheck, test, build]
    runs-on: ubuntu-latest
    steps:
      - name: Verify all checks passed
        run: |
          if [ "${{ contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled') }}" = "true" ]; then
            echo "One or more CI jobs failed."
            exit 1
          fi
          echo "All CI jobs passed."
```

Note the explicit `actions/checkout@v4` before `uses: ./.github/actions/setup` in every job: a local composite action cannot be resolved until the repository is on disk. The checkout inside the composite then runs as a no-op refresh.

- [ ] **Step 3: Verify the workflow parses**

```bash
brew install actionlint 2>/dev/null || true
actionlint .github/workflows/ci.yml
```

Expected: no output. If `actionlint` is unavailable, fall back to a YAML syntax check:

```bash
node -e "require('fs').readFileSync('.github/workflows/ci.yml','utf8'); console.log('read ok')"
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('yaml ok')"
```

- [ ] **Step 4: Verify each job's command works locally**

```bash
npm run lint && npm run typecheck && npm run test
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54351 \
NEXT_PUBLIC_SUPABASE_ANON_KEY=ci-placeholder-anon-key \
NEXT_PUBLIC_APP_URL=http://localhost:3000 \
npm run build
```

Expected: all four exit 0. The build must succeed with *only* those three env vars set — that proves the CI `build` job won't fail on env validation.

- [ ] **Step 5: Commit**

```bash
git add .github/actions/setup/action.yml .github/workflows/ci.yml
git commit -m "ci: lint, typecheck, test and build jobs"
```

---

## Task 6: CI — the database job

The highest-value job and the one with a non-obvious constraint: a plain `postgres:17` service container **cannot** run these migrations, because `0001_foundation_rls.sql` calls `auth.uid()` and the `auth` schema only exists once GoTrue has migrated. So CI runs a trimmed real Supabase stack.

**Files:**
- Modify: `.github/workflows/ci.yml` (add the `db` job; add `db` to the aggregator's `needs`)

**Interfaces:**
- Consumes: the `ci` aggregator job from Task 5.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the `db` job**

In `.github/workflows/ci.yml`, insert this job after `build` and before `ci`:

```yaml
  db:
    runs-on: ubuntu-latest
    env:
      DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:54352/postgres
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup

      - uses: supabase/setup-cli@v1
        with:
          version: latest

      # Only db + auth are needed. Excluding the rest saves roughly a minute.
      # auth is NOT optional: 0001_foundation_rls.sql calls auth.uid().
      - name: Start Supabase
        run: supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor

      - name: Apply migrations to an empty database
        run: npx drizzle-kit migrate

      - name: Check for schema/migration drift
        run: |
          npx drizzle-kit generate
          if ! git diff --quiet --exit-code src/db/migrations; then
            echo "::error::src/db/schema was changed without generating a migration."
            echo "Run 'npm run db:generate' and commit the result."
            git diff --stat src/db/migrations
            exit 1
          fi
          echo "No drift: committed migrations match the Drizzle schema."
```

- [ ] **Step 2: Add `db` to the aggregator**

In the same file, change the `ci` job's `needs` line:

```yaml
    needs: [lint, typecheck, test, build, db]
```

- [ ] **Step 3: Verify the exclude list is valid**

`supabase start -x` rejects unknown service names, and the valid set differs between CLI versions. Confirm the list works before relying on it in CI:

```bash
supabase stop
supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor
```

Expected: the stack starts. If the CLI reports an unknown service, remove just that name from the list in both this command and the workflow, and re-run.

- [ ] **Step 4: Prove the drift check catches real drift**

This is the job's whole reason to exist, so verify it before trusting it. Add a real column to a real table — a plain exported constant would produce no migration and prove nothing.

In `src/db/schema/orgs.ts`, temporarily add a column to the `orgs` table, immediately after the `slug` line:

```ts
  driftProbe: text("drift_probe"),
```

Then:

```bash
npx drizzle-kit generate
git diff --quiet --exit-code src/db/migrations; echo "drift-detected(expect 1)=$?"
```

Expected: `drift-detected(expect 1)=1`, because `generate` wrote a new migration file that isn't committed. That is exactly what the CI job fails on.

- [ ] **Step 5: Revert the probe completely**

```bash
git checkout src/db/schema/orgs.ts
git checkout -- src/db/migrations 2>/dev/null || true
git clean -fd src/db/migrations
git status --short src/db
```

Expected: `git status --short src/db` prints nothing. The generated probe migration and its snapshot under `src/db/migrations/meta/` must both be gone — if `_journal.json` still shows a third entry, the revert was incomplete.

- [ ] **Step 6: Verify migrations apply to an empty database**

```bash
npm run db:reset
```

Expected: succeeds. This is the same path the CI job takes (empty DB → `drizzle-kit migrate`), so a failure here means the CI job would fail too.

- [ ] **Step 7: Verify the workflow still parses**

```bash
actionlint .github/workflows/ci.yml || python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('yaml ok')"
```

- [ ] **Step 8: Commit**

```bash
git status --short   # must be clean apart from the workflow file
git add .github/workflows/ci.yml
git commit -m "ci: verify migrations apply and detect schema drift"
```

---

## Task 7: Deploy workflow and Dependabot

**Files:**
- Create: `.github/workflows/deploy.yml`
- Create: `.github/dependabot.yml`

**Interfaces:**
- Consumes: the `CI` workflow name from Task 5 (`workflow_run` matches on the workflow's `name:`, not its filename).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the deploy workflow**

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy

# Triggered by CI finishing, not by the push itself — so a green CI run is a
# structural precondition of this workflow starting, rather than a step inside
# it that could be skipped or reordered.
on:
  workflow_run:
    workflows: [CI]
    branches: [main]
    types: [completed]
  workflow_dispatch:

permissions:
  contents: read

# Deploys queue rather than overlap: two concurrent `drizzle-kit migrate` runs
# against one database is a corruption risk.
concurrency:
  group: deploy-production
  cancel-in-progress: false

jobs:
  deploy:
    if: github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success'
    runs-on: ubuntu-latest
    environment: production
    steps:
      # workflow_run defaults to the tip of main, which may have moved past the
      # commit CI actually verified. Check out the verified SHA.
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.workflow_run.head_sha || github.sha }}

      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm

      - run: npm ci

      # Migrate BEFORE promoting, so the schema is always at or ahead of the
      # code. Between this step and the deploy below, the currently-live code
      # runs against the new schema — migrations must be backward compatible.
      - name: Migrate production database
        run: npx drizzle-kit migrate
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}

      - name: Install Vercel CLI
        run: npm install --global vercel@latest

      - name: Pull Vercel environment
        run: vercel pull --yes --environment=production --token=${{ secrets.VERCEL_TOKEN }}
        env:
          VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}

      - name: Build
        run: vercel build --prod --token=${{ secrets.VERCEL_TOKEN }}
        env:
          VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}

      - name: Deploy
        run: vercel deploy --prebuilt --prod --token=${{ secrets.VERCEL_TOKEN }}
        env:
          VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
```

- [ ] **Step 2: Write the Dependabot config**

Create `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
    groups:
      # One PR for the routine churn; majors still come through individually.
      minor-and-patch:
        update-types: [minor, patch]

  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
```

- [ ] **Step 3: Verify both files parse**

```bash
actionlint .github/workflows/deploy.yml || python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml')); print('deploy yaml ok')"
python3 -c "import yaml; yaml.safe_load(open('.github/dependabot.yml')); print('dependabot yaml ok')"
```

- [ ] **Step 4: Confirm the `workflow_run` name matches**

```bash
grep -m1 '^name:' .github/workflows/ci.yml
grep -A2 'workflow_run:' .github/workflows/deploy.yml
```

Expected: `ci.yml` declares `name: CI`, and `deploy.yml` lists `workflows: [CI]`. A mismatch here means deploy silently never fires — the most likely defect in this task.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/deploy.yml .github/dependabot.yml
git commit -m "ci: gated production deploy (migrate then Vercel) and dependabot"
```

---

## Task 8: Documentation

The point of the whole plan: someone who has never seen this repo can get running without asking anyone.

**Files:**
- Modify: `README.md`
- Modify: `.env.example`

**Interfaces:**
- Consumes: every script added in Tasks 1, 3, and 4.
- Produces: nothing.

- [ ] **Step 1: Annotate `.env.example` with local defaults**

Replace `.env.example` with:

```bash
# Copy to .env.local. `npm run setup` fills any value left blank here from the
# local Supabase stack — it never overwrites a value you have already set.

# --- Supabase ---
# Local defaults (see supabase/config.toml): http://127.0.0.1:54351
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
# Server-only. Bypasses RLS — NEVER expose to the client.
SUPABASE_SERVICE_ROLE_KEY=

# --- Database (Drizzle) ---
# Local default: postgresql://postgres:postgres@127.0.0.1:54352/postgres
# In production use the direct (5432) URL for migrations, not the pooler —
# transaction-mode pooling cannot run DDL reliably.
DATABASE_URL=

# --- App ---
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

- [ ] **Step 2: Replace the README's `Getting started` section**

Replace everything from `## Getting started` up to (but not including) `## Layout` with:

````markdown
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
before booting Next.js on http://localhost:3000.

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
| `npm run verify` | Everything CI runs: lint + typecheck + test |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest (`test:watch` for watch mode) |
| `npm run db:reset` | Wipe, re-migrate, and re-seed the local database |
| `npm run db:generate` | Generate a Drizzle migration from the schema |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Demo org + user (idempotent) |
| `npm run db:studio` | Drizzle Studio |
| `npm run supabase:start` / `:stop` / `:status` | Manage the local stack |

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

## Migrations

Drizzle owns migrations; they live in `src/db/migrations/`, **not**
`supabase/migrations/`. Change `src/db/schema/`, then:

```bash
npm run db:generate   # writes a new migration
npm run db:migrate    # applies it locally
```

CI fails if the schema and the committed migrations have drifted.

Production migrations run automatically from `.github/workflows/deploy.yml`
*before* the new build is promoted — so a migration must be backward compatible
with the currently-deployed code. Make additive changes only; split destructive
changes (dropping a column, renaming) across two releases.

## CI/CD

Every PR runs lint, typecheck, tests, a production build, and a database job
that applies migrations to an empty database and checks for schema drift.
Require the single `ci` status in branch protection.

Merges to `main` trigger `Deploy`, which migrates the production database and
then builds and promotes to Vercel. Vercel's own Git auto-deploy must stay
**disabled** so the two never race.

Secrets required under the `production` GitHub Environment: `DATABASE_URL`
(direct connection, port 5432), `VERCEL_TOKEN`, `VERCEL_ORG_ID`,
`VERCEL_PROJECT_ID`.
````

- [ ] **Step 3: Verify every documented script exists**

```bash
for s in dev setup verify build lint typecheck test db:reset db:generate db:migrate db:seed db:studio supabase:start supabase:stop supabase:status; do
  node -e "process.exit(require('./package.json').scripts['$s'] ? 0 : 1)" || echo "MISSING: $s"
done
echo "script check done"
```

Expected: no `MISSING:` lines.

- [ ] **Step 4: Verify the documented ports match config.toml**

```bash
grep -nE '^port = 543(5[1-4])' supabase/config.toml
```

Expected: `54351`, `54352`, `54353`, `54354` all present.

- [ ] **Step 5: Commit**

```bash
npm run verify
git add README.md .env.example
git commit -m "docs: three-command quickstart, ports, troubleshooting, CI/CD"
```

---

## Final verification

- [ ] **Full clean-clone rehearsal**

```bash
supabase stop
mv .env.local /tmp/env.local.rehearsal
rm -rf .next
npm run dev
```

Expected: preflight starts Supabase, recreates `.env.local`, applies migrations, and Next.js serves http://localhost:3000. Stop the server, then `npm run db:reset && npm run verify`.

- [ ] **Restore your env file**

```bash
cp /tmp/env.local.rehearsal .env.local 2>/dev/null || true
```

- [ ] **Note the manual steps that cannot be automated here**

Report these to the user rather than attempting them:

1. Create the GitHub repository and add the remote (none is configured).
2. In Vercel → Project → Settings → Git, **disable automatic deployments** for `main`.
3. Create the `production` GitHub Environment and add `DATABASE_URL`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.
4. Enable branch protection on `main` requiring the `ci` status check.
