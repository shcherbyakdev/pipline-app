import { loadEnvFile } from "node:process";

try {
  loadEnvFile(".env.local");
} catch {
  // env may be exported directly
}

// No top-level await: this project has no "type": "module" in package.json,
// so tsx/esbuild transforms scripts to CJS, which top-level await cannot
// target (seed.ts's main()-wrapper precedent).
async function main() {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const secret = process.env.SCHEDULING_DRAIN_SECRET;
  if (!secret) {
    console.error("SCHEDULING_DRAIN_SECRET not set");
    process.exit(1);
  }

  const res = await fetch(`${base}/api/scheduling/drain`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    console.error(`drain failed: ${res.status}`, body);
    process.exit(1);
  }
  console.log("drain:", body);
}

main().catch((error: unknown) => {
  console.error("scheduling:drain failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
