/* Product flags. Compile-time constants, not env vars: the MVP ships one shape
   and flipping a flag is a deliberate code change reviewed like any other. */

/** Rentals (R1/R2 shipped; R3 planned in
    docs/superpowers/plans/2026-08-17-rentals-r3.md) are parked for the
    appointments-only MVP (ruling 2026-08-17). While false: /rentals 404s, the
    /bookings timeline view is unreachable, the public widget lists no
    offerings, and the rentals public actions refuse. Schema, migrations, RPCs
    and existing rows are untouched — flip to true to un-park. */
export const RENTALS_ENABLED = false;
