import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Deliberately does NOT load .env.local. This wizard validates PRODUCTION
// readiness; reading local dev env here would let an operator who forgot to
// export a credential silently validate their laptop instead (the local
// value is "present", so checkCredentials passes, and checkMigrations would
// count local migration rows against the local journal and print a
// misleading PASS). docs/runbook-production.md mandates explicit exports.
const REF = process.env.PROD_PROJECT_REF ?? "";
const APP_URL = "https://booklo.co";
const SEND_DOMAIN = "mail.booklo.co";

export type CheckResult = { name: string; ok: boolean; detail: string };

/** True when `ref` appears as a project_id under any [remotes.*] table. */
export function configHasRemoteRef(toml: string, ref: string): boolean {
  if (!ref) return false;
  const remotes = toml.split(/^\[remotes\./m).slice(1);
  const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return remotes.some((block) => new RegExp(`project_id\\s*=\\s*"${escaped}"`).test(block));
}

/** True when `url` is a Supabase SESSION pooler URL (port 5432), the only
 * form the wizard's own checks (and GitHub Actions migrations/dumps) are
 * safe to run against. Catches an operator who exported the :6543
 * transaction pooler (Vercel's value) or a direct-connection URL instead. */
export function isSessionPoolerUrl(url: string): boolean {
  return url.includes("pooler.supabase.com:5432");
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

  const databaseUrl = process.env.DATABASE_URL;
  const wrongPooler = Boolean(databaseUrl) && !isSessionPoolerUrl(databaseUrl!);

  const details: string[] = [];
  if (missing.length) details.push(`missing: ${missing.join(", ")}`);
  if (wrongPooler) {
    details.push(
      "DATABASE_URL is not the session pooler (expected pooler.supabase.com:5432) — " +
        "looks like the :6543 transaction pooler or the direct connection",
    );
  }

  return {
    name: "credentials exported",
    ok: missing.length === 0 && !wrongPooler,
    detail: details.length ? details.join("; ") : "all present",
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
