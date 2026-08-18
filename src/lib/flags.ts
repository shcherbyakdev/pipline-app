/* Product flags. Compile-time constants, not env vars: the MVP ships one shape
   and flipping a flag is a deliberate code change reviewed like any other. */

/** Rentals (R1/R2 shipped; R3 planned in
    docs/superpowers/plans/2026-08-17-rentals-r3.md) are parked for the
    appointments-only MVP (ruling 2026-08-17). While false: /rentals 404s, the
    /bookings timeline view is unreachable, the public widget lists no
    offerings, and the rentals public actions refuse. Schema, migrations, RPCs
    and existing rows are untouched — flip to true to un-park. */
export const RENTALS_ENABLED = false;

/** Billing (spec docs/superpowers/specs/2026-08-18-pricing-and-billing-design.md).
    While false: no plan gates, no /billing nav item, no /pricing route, no
    badge changes — early access continues exactly as today. Tables, the
    provider seam and the webhook route exist regardless so the Stripe
    account can be wired before the flip. */
export const BILLING_ENABLED = false;
