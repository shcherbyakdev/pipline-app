/* Product flags (spec 2026-08-18-internal-utils §3.5). FLAG_DEFAULTS is the
   environment default — a deliberate code change reviewed like any other.
   An org may be switched off the default from /utils/flags: rows in
   org_feature_flags override it per org, resolved by lib/flags/resolve.ts.
   Only where there is NO org (the marketing site, /pricing) may code read
   FLAG_DEFAULTS directly — every other reader takes resolved `Flags`.

   This module is plain (no server-only): client components receive `Flags`
   as props and may import the types and FLAG_META. */

export const FLAG_DEFAULTS = {
  /** Billing (spec 2026-08-18-pricing-and-billing-design.md). While off for an
      org: no plan gates on staff/service creation, no /billing nav item or
      page, no entitlement reads — the public offering, the badge and the
      embed studio take the "everything allowed" branch. NOT gated: the
      "Powered by Booklo" badge itself; the flag only changes WHO may switch
      it off (badgeShows / badgeVisible, lib/billing/entitlements.ts). */
  billing: false,
  /** Rentals were parked for the appointments-only MVP (ruling 2026-08-17)
      and UN-PARKED 2026-08-24 by the resource-booking pivot (H1). The flag
      stays as a per-org kill switch (/utils/flags); what an org actually
      sells is the org-mode pair on `orgs` (offers_appointments /
      offers_rentals, 0054). While off: /rentals 404s, the /bookings timeline
      view is unreachable, the public surface lists no offerings, the rentals
      public actions refuse. */
  rentals: true,
  /** /overview. The 2026-08-18 ruling (four org-wide tiles is not yet a
      dashboard worth the first nav slot) is SUPERSEDED by booking approval:
      the requests inbox is work waiting on the owner, and that earns the
      slot — the tiles now ride along under it. An org can still be opted out
      per-org from /utils/flags. While off: /overview 404s, the sidebar starts
      at Bookings and no request count is fetched for it. */
  overview: true,
  /** ⌘K palette (ruling 2026-08-18): presented as "Search" but only navigates.
      While off: no sidebar Search button and ⌘K is inert (never mounts). */
  command_menu: false,
} as const;

export type FlagKey = keyof typeof FLAG_DEFAULTS;
export type Flags = Record<FlagKey, boolean>;

export const FLAG_KEYS = Object.keys(FLAG_DEFAULTS) as readonly FlagKey[];

/** For /utils/flags. Copy for the owner, not for customers. */
export const FLAG_META: Record<FlagKey, { label: string; description: string }> = {
  billing: { label: "Billing", description: "Plans, gates, /billing page and nav item, entitlement reads." },
  rentals: { label: "Rentals", description: "/rentals, the bookings timeline, rental offerings on the public widget." },
  overview: {
    label: "Overview",
    description: "The /overview requests inbox and stat tiles, their nav row and its request count.",
  },
  command_menu: { label: "Command menu", description: "The ⌘K palette and the sidebar Search button." },
};
