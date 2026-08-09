import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    // Integration tests need the local Supabase stack; they run via
    // `npm run test:integration` (see vitest.integration.config.ts).
    exclude: ["**/node_modules/**", "**/*.integration.test.ts"],
  },
});
