import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  // `server-only` is a Next.js build-time marker with no Node resolution
  // (vitest.integration.config.ts precedent). drain-isolation.test.ts is a
  // plain-vitest test that imports chasing/drain.ts, which imports it
  // directly — alias it to the same empty stub so that import resolves.
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    // Integration tests need the local Supabase stack; they run via
    // `npm run test:integration` (see vitest.integration.config.ts).
    exclude: ["**/node_modules/**", "**/*.integration.test.ts"],
  },
});
