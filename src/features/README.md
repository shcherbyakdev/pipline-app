# Features — domain slices

Each folder is one aggregate of the Booklo domain. The `app/` router stays
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

Aggregates: `templates`, `programs`, `units`, `stages`, `evidence`,
`approvals`, `blockers`, `participants`, `import`, `portal`.

## Optimistic mutations (project convention)

Established in `templates/components/stage-list.tsx`. Client components own a
`useOptimistic(serverData, reducer)` pair; every mutation (1) dispatches the
optimistic event inside a transition, (2) awaits the Server Action, (3) on
`{ ok: false }` shows `toast.error` — the action's `revalidatePath` re-renders
server truth either way. Actions return `{ ok: true } | { ok: false; error }`
with the generic copy from `GENERIC_WRITE_ERROR`; raw errors are logged
server-side only. Row-level editors that hold local input state derived from
server props (e.g. `StageRow`'s name field) must not sync that state with a
`useEffect` (flagged by `react-hooks/set-state-in-effect`) — key the row on
`` `${id}:${serverValue}` `` at the call site instead, so a server-truth change
remounts the row and re-derives local state for free.
