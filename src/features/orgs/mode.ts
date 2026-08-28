/* What an org sells. Mirrors orgs.offers_appointments / offers_rentals (0054,
   at least one is always true). Pure and dependency-free so nav.ts, layouts
   and pages can all import it; the nav filter itself lives in nav.ts
   (navItemsFor) next to the list it filters. */

export type Channel = "appointments" | "rentals";
export type OrgMode = { offersAppointments: boolean; offersRentals: boolean };

export const BOTH: OrgMode = { offersAppointments: true, offersRentals: true };

export function channelsOf(mode: OrgMode): Channel[] {
  const out: Channel[] = [];
  if (mode.offersAppointments) out.push("appointments");
  if (mode.offersRentals) out.push("rentals");
  return out;
}

/** Rentals-only orgs land on the unit timeline; anyone with appointments
    keeps the week calendar (S2 ruling: Bookings is the post-login surface).
    H2: hourly rentals are timed events on the week grid, not the
    nights/days timeline — a rentals-only org that sells by the hour lands
    on week too, `hasHourly` says whether it has any such offering. */
export function defaultBookingsView(mode: OrgMode, hasHourly: boolean): "week" | "timeline" {
  return mode.offersRentals && !mode.offersAppointments && !hasHourly ? "timeline" : "week";
}

/** Project the mode off any wider org record (session Org, a queries row). */
export function modeOf(org: { offersAppointments: boolean; offersRentals: boolean }): OrgMode {
  return { offersAppointments: org.offersAppointments, offersRentals: org.offersRentals };
}

/** The mode a surface should actually render: the org's declared channels
    intersected with the feature-flag kill switches (H1: only rentals has
    one). Compose with this everywhere instead of hand-writing
    `flags.rentals && mode.offersRentals`. */
export function effectiveMode(flags: { rentals: boolean }, mode: OrgMode): OrgMode {
  return { ...mode, offersRentals: flags.rentals && mode.offersRentals };
}

/** The mode a preview should SHOW: the declared mode narrowed to the
    channels that have something bookable in them (an active service; an
    active space with an active unit — listPublicOfferings' rule), because
    that is all the public page lists. An org with nothing anywhere yet keeps
    its declared mode, so the previews can still hand the widget a canned
    stand-in per channel (preview-catalog.ts). Never widens. */
export function presentMode(mode: OrgMode, has: { services: boolean; spaces: boolean }): OrgMode {
  const narrowed: OrgMode = {
    offersAppointments: mode.offersAppointments && has.services,
    offersRentals: mode.offersRentals && has.spaces,
  };
  return narrowed.offersAppointments || narrowed.offersRentals ? narrowed : mode;
}
