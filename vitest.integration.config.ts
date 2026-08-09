import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Runs against the LOCAL Supabase stack (supabase start). Env comes from
// .env.local locally (loaded by the test file) or exported vars in CI.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
