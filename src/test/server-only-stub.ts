// Stands in for the `server-only` package under Vitest, which has no Node
// resolution for it (it is a Next.js build-time marker). Aliased in
// vitest.integration.config.ts. Intentionally empty — the server-only
// guarantee is enforced by `next build`, not by the test runner.
export {};
