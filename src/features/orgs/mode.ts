/* What an org sells. Mirrors orgs.offers_appointments / offers_rentals
   (0054; exactly one is true since 0073 — a workspace is appointments OR
   spaces). Still two booleans, not one word: every consumer reads only the
   channel it cares about, and `effectiveMode` can turn that one channel off
   too (the rentals kill switch), so neither flag is derived from the other.
   Pure and dependency-free so nav.ts, layouts and pages can all import it;
   the nav filter itself lives in nav.ts (navItemsFor) next to the list it
   filters. */

export type Channel = "appointments" | "rentals";
export type OrgMode = { offersAppointments: boolean; offersRentals: boolean };

/** Rentals orgs land on the unit timeline; appointments keep the week
    calendar (S2 ruling: Bookings is the post-login surface). H2: hourly
    rentals are timed events on the week grid, not the nights/days timeline —
    a rentals org that sells by the hour lands on week too, `hasHourly` says
    whether it has any such offering. */
export function defaultBookingsView(mode: OrgMode, hasHourly: boolean): "week" | "timeline" {
  return mode.offersRentals && !mode.offersAppointments && !hasHourly ? "timeline" : "week";
}

/** Project the mode off any wider org record (session Org, a queries row). */
export function modeOf(org: { offersAppointments: boolean; offersRentals: boolean }): OrgMode {
  return { offersAppointments: org.offersAppointments, offersRentals: org.offersRentals };
}

/** The mode a surface should actually render: the org's declared channel
    intersected with the feature-flag kill switches (H1: only rentals has
    one). Compose with this everywhere instead of hand-writing
    `flags.rentals && mode.offersRentals`. */
export function effectiveMode(flags: { rentals: boolean }, mode: OrgMode): OrgMode {
  return { ...mode, offersRentals: flags.rentals && mode.offersRentals };
}
