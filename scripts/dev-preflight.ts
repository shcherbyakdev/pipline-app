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

// This preflight runs before Next.js picks a port, so it cannot know the
// dev server's URL (e.g. 3000 is sometimes already taken and Next falls
// back to 3001). Let Next's own "Local: http://…" line be the URL of record.
console.log("  ✓ preflight complete — starting Next.js\n");
