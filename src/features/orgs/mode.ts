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
    keeps the week calendar (S2 ruling: Bookings is the post-login surface). */
export function defaultBookingsView(mode: OrgMode): "week" | "timeline" {
  return mode.offersRentals && !mode.offersAppointments ? "timeline" : "week";
}

/** Project the mode off any wider org record (session Org, a queries row). */
export function modeOf(org: { offersAppointments: boolean; offersRentals: boolean }): OrgMode {
  return { offersAppointments: org.offersAppointments, offersRentals: org.offersRentals };
}
