# S8 — Migration kit

Date: 2026-09-09. Roadmap slice S8 (`2026-09-07-studio-ops-roadmap-design.md`, D1 order S1 → S2 → S3 → S7 → S4 → S6 → **S8**). The roadmap row: "CSV import of future bookings (re-point the legacy importer), a pricing worksheet that maps Bookero/Calendesk rules onto S1, the parallel-run checklist. Manual for pilot 1; tooling only if pilot 2 needs it." Bounded slice, designed and approved in chat 2026-09-09; no separate plan.

## Rulings

1. **Internal importer, not studio-facing.** The CSV import lives in the owner-only `/utils` back office (`INTERNAL_EMAILS` gate, `requireInternal()`); Booklo staff run it for the pilot during assisted onboarding. This keeps the roadmap's "manual for pilot 1" while sparing 50–100 hand entries. A studio-facing importer is the pilot-2 follow-up.
2. **Money: a `paid` column, default yes.** Migrated bookings were sold in the old tool. A paid row is created confirmed and settled in full through the S7 cash path (`mark_booking_paid` → manual `balance` payment), so the daily list never chases it; `paid=no` keeps the computed price as a balance due. The old tool's price is *not* imported — the snapshot is the studio's current rules (say so in the worksheet).
3. **Service role runs the RPCs.** Booklo staff are not members of the studio's org, so `create_rental_booking_hours_admin` and `mark_booking_paid` admit `auth.role() = 'service_role'` alongside org members (0085, the `list_balances_due` idiom) and are granted to `service_role`. Bodies otherwise verbatim. The admin RPC still enforces opening hours, the duration grid, turnover and the `booking_units` EXCLUDE, so a row the setup does not allow is refused per row.
4. **Idempotency by the row, not by the EXCLUDE.** A space with a second unit would take a duplicate on the other unit (seen on the demo org during QA). Before each RPC call the runner looks for a reserving booking with the same space, start and client name and reports it as `skipped`. Physical collisions (`taken`, 23P01, 40P01) are `skipped` too. Re-running a corrected file is therefore safe.
5. **Per-row results, not all-or-nothing.** Each row is its own RPC transaction; the result table lists created / skipped / failed with the spreadsheet row number and a reason. The legacy units importer's all-or-nothing rule was dropped: a migrating studio fixes two rows and re-runs.
6. **Hours mode only; no people, extras or equipment columns.** The composite/equipment model (S6) makes a whole-studio row import cleanly as a space by name; attaching lamps or head counts to imported rows is a follow-up.

## Pieces

- `src/features/utils/import-rows.ts` — pure CSV → rows (`space,date,start,end,client_name,client_email,note,paid`; org-local times → UTC via `wallTimeToUtc`; grid check against the space; ≤ 500 rows; BOM/header tolerant). Unit-tested.
- `src/features/utils/import-run.ts` — `runImport(admin, rows)`: already-imported check → admin RPC → optional `mark_booking_paid` (`nothing_due` tolerated) → per-row result. Integration-tested against the local stack (created / skipped / refused / unpriced / second-unit idempotency).
- `src/features/utils/import-actions.ts` — `previewBookingsImport` and `runBookingsImport`: `requireInternal()`, org context (timezone + active hourly non-equipment spaces with their grid), parse the raw text server-side for both steps so what was previewed is what is written.
- `src/app/utils/import/page.tsx` + `features/utils/components/import-panel.tsx` — org picker → file → preview → confirm → results. Linked from the `/utils` hub.
- `src/db/migrations/0085_import_gates.sql` — the two widened gates (function-only, no snapshot; journal idx 85; additive, normal deploy).
- `docs/migration/bookings-template.csv`, `docs/migration/pricing-worksheet.md`, `docs/migration/parallel-run-checklist.md` — the manual half of the kit.

## Deferred

Studio-facing import UI; dates-mode rows; people/extras/equipment columns; importing the old price; confirmation or manage-link mails for imported bookings (none are sent); a unit column to pin a specific unit; export of Booklo bookings back to CSV. Pre-existing console warning ("Encountered a script tag while rendering React component") appears on every `/utils` page — not S8's.
