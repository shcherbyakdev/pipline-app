import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Runs against the LOCAL Supabase stack (supabase start). Env comes from
// .env.local locally (loaded by the test file) or exported vars in CI.
export default defineConfig({
  plugins: [tsconfigPaths()],
  // `server-only` is a Next.js build-time marker with no Node resolution, so
  // importing anything from @/lib/tokens (or the Supabase clients) blows up
  // under plain Vitest. Alias it to an empty module — the guarantee it
  // encodes is enforced by `next build`, not by the test runner.
  // fileURLToPath, not URL.pathname: the latter percent-encodes, which breaks
  // the moment the checkout path contains a space.
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    setupFiles: ["./src/test/integration-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Drain/recur ticks are deliberately table-wide (no org scoping — that's
    // the whole point of a drain), so two files running in parallel workers
    // race each other's due rows on the one shared local Supabase stack.
    // In-file test order already carries each suite's sequencing
    // assumptions; serializing FILES (not the tests within a file) removes
    // the cross-file race without touching the table-wide design.
    fileParallelism: false,
  },
});
