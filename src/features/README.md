# Features — domain slices

Each folder is one aggregate of the RolloutOS domain. The `app/` router stays
thin (routing + composition); the real logic lives here.

**Per-feature convention** (add files as the feature needs them):

```
features/<name>/
├── components/     # UI specific to this feature
├── queries.ts      # read paths (Drizzle / Supabase reads)
├── actions.ts      # Server Actions (writes), input-validated with Zod
├── schema.ts       # Zod schemas — shared by client forms and server actions
└── types.ts        # domain types derived from the DB schema
```

Rules of thumb:

- Cross-feature reads go through a feature's `queries.ts`, never by reaching
  into another feature's internals.
- Every Server Action validates its input with a Zod schema from `schema.ts`.
- Keep files small and single-purpose; when one grows large, it's doing too much.

Aggregates: `templates`, `rollouts`, `units`, `stages`, `evidence`,
`approvals`, `blockers`, `participants`, `import`, `portal`.
