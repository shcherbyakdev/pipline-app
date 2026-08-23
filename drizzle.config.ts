import { loadEnvFile } from "node:process";
try {
  loadEnvFile(".env.local");
} catch {}

import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set (put it in .env.local or export it).");
}

// Loopback only, unless the caller opts in. `loadEnvFile` above makes a bare
// `npx drizzle-kit migrate` target whatever .env.local names — and the
// runbook has the operator export a production URL for other tools in the
// same shell. One forgotten `unset` and that bare command would migrate
// (or `push`, or `drop`) the live database. deploy.yml sets ALLOW_REMOTE_DB
// on its migrate step; that is the one place it is meant to be set.
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
let host = "";
try {
  host = new URL(url).hostname;
} catch {
  // Unparseable stays "" and is refused below: a URL we cannot read is not
  // one we can prove is local.
}
if (!LOOPBACK_HOSTS.has(host) && process.env.ALLOW_REMOTE_DB !== "1") {
  throw new Error(
    `DATABASE_URL points at "${host || "<unparseable>"}", not the local stack. ` +
      "Refusing to run drizzle-kit against a remote database. " +
      "If this is deliberate (docs/runbook-production.md §3), prefix the command with ALLOW_REMOTE_DB=1.",
  );
}

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url },
  verbose: true,
  strict: true,
});
