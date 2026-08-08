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

const migrationsApplied: Check = {
  name: "Database migrations",
  run() {
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
