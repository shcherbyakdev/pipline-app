import { loadEnvFile } from "node:process";

try {
  loadEnvFile(".env.local");
} catch {
  // env may be exported directly
}

const DRAIN_PATH = "/api/scheduling/drain";

// Where to send the tick. `--url <base>` beats `DRAIN_URL`, which beats
// NEXT_PUBLIC_APP_URL — the last of which .env.local sets to localhost, so an
// operator draining production by hand (runbook §7) needs one of the first
// two rather than a shell-wide NEXT_PUBLIC_APP_URL export that would leak
// into every other script's links. Either form is accepted: a bare origin
// (`https://booklo.co`) or the full route, which is what the Cloudflare
// Worker's DRAIN_URL secret holds, so that value can be pasted as-is.
function drainEndpoint(argv: string[]): string {
  let override: string | undefined;
  const flag = argv.findIndex((a) => a === "--url" || a.startsWith("--url="));
  if (flag !== -1) {
    override = argv[flag].startsWith("--url=") ? argv[flag].slice("--url=".length) : argv[flag + 1];
    if (!override) {
      console.error("--url needs a value, e.g. --url https://booklo.co");
      process.exit(1);
    }
  }
  const base = (override ?? process.env.DRAIN_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
    /\/+$/,
    "",
  );
  return base.endsWith(DRAIN_PATH) ? base : `${base}${DRAIN_PATH}`;
}

// No top-level await: this project has no "type": "module" in package.json,
// so tsx/esbuild transforms scripts to CJS, which top-level await cannot
// target (seed.ts's main()-wrapper precedent).
async function main() {
  const endpoint = drainEndpoint(process.argv.slice(2));
  const secret = process.env.SCHEDULING_DRAIN_SECRET;
  if (!secret) {
    console.error("SCHEDULING_DRAIN_SECRET not set");
    process.exit(1);
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    console.error(`drain failed: ${res.status} (${endpoint})`, body);
    process.exit(1);
  }
  console.log(`drain (${endpoint}):`, body);
}

main().catch((error: unknown) => {
  console.error("scheduling:drain failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
