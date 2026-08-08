import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import {
  parseEnvFile,
  parseSupabaseStatusEnv,
  supabaseEnvToAppEnv,
  fillBlankEnvValues,
} from "./env-file";
import { hostnameOf, isLoopbackHost } from "./host-guard";

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

const MAX_ERROR_LINES = 5;

/** Narrows a thrown `execFileSync` error just enough to read its captured streams. */
function hasStream(error: unknown, key: "stderr" | "stdout"): error is Record<typeof key, unknown> {
  return typeof error === "object" && error !== null && key in error;
}

function streamText(value: unknown): string {
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return typeof value === "string" ? value : "";
}

/**
 * Turn a thrown `execFileSync` error into something a developer can act on.
 * `error.message` alone is just "Command failed: <cmd>" — the actual cause
 * lives in the child's stderr (falling back to stdout, then the bare
 * message if the process never produced output). Trimmed to the last few
 * non-blank lines: that's where the real failure is, and an unbounded dump
 * would swamp the terminal.
 */
function describeExecError(error: unknown): string {
  const stderr = hasStream(error, "stderr") ? streamText(error.stderr) : "";
  const stdout = hasStream(error, "stdout") ? streamText(error.stdout) : "";
  const message = error instanceof Error ? error.message : String(error);

  const text = stderr.trim() || stdout.trim() || message;
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines.slice(-MAX_ERROR_LINES).join("\n") || message;
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
        reason: `\`supabase start\` failed: ${describeExecError(error)}`,
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
        reason: `Could not read Supabase credentials: ${describeExecError(error)}`,
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

/**
 * Mirrors drizzle.config.ts's own resolution: it calls
 * `loadEnvFile(".env.local")` (which never overwrites an already-exported
 * variable) and then reads `process.env.DATABASE_URL`. This process never
 * loads `.env.local` itself — that only happens inside the `drizzle-kit`
 * child process — so to inspect the URL *before* spawning that child we
 * have to replicate the same precedence: an exported env var wins, and
 * `.env.local` is the fallback.
 */
function resolveDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (!existsSync(ENV_FILE)) return undefined;
  return parseEnvFile(readFileSync(ENV_FILE, "utf8")).DATABASE_URL || undefined;
}

/**
 * `drizzle-kit migrate` applies DDL using `DATABASE_URL` from `.env.local`
 * (see drizzle.config.ts). A developer pointed at a remote or staging
 * project must never have that database migrated behind their back just
 * because they ran `npm run dev` — so this check migrates only when the
 * target is confirmed loopback, and otherwise warns and steps aside rather
 * than failing (a developer deliberately working against a remote project
 * should still get a working dev server).
 */
const migrationsApplied: Check = {
  name: "Database migrations",
  run() {
    const rawUrl = resolveDatabaseUrl();
    const hostname = hostnameOf(rawUrl);

    if (hostname === null) {
      console.warn(
        `\n  ! Database migrations: DATABASE_URL is missing or not a valid Postgres URL — skipping.\n` +
          "    Set it to your local Supabase instance, or apply migrations yourself if this is intentional.\n",
      );
      return { ok: true, note: "skipped — DATABASE_URL unset or unparseable" };
    }

    if (!isLoopbackHost(hostname)) {
      console.warn(
        `\n  ! Database migrations: DATABASE_URL points at non-loopback host "${hostname}" — refusing to run\n` +
          "    `drizzle-kit migrate` against it. This looks like a remote or staging project; skipping so it\n" +
          "    isn't modified. Migrate it yourself if that's what you intend.\n",
      );
      return { ok: true, note: `skipped — non-local host "${hostname}"` };
    }

    try {
      run("npx", ["drizzle-kit", "migrate"]);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: `\`drizzle-kit migrate\` failed: ${describeExecError(error)}`,
        remedy: "Run `npm run db:reset` to rebuild the local database from scratch.",
      };
    }
  },
};

export const checks: Check[] = [dockerRunning, supabaseRunning, envLocalPopulated, migrationsApplied];
