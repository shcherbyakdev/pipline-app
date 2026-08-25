import type { OrgMode } from "./mode";

/* The one place the rentals channel is named for people (H5a ruling:
   "Spaces" — rooms, studios and gear alike, whatever the range mode). Code
   identifiers (rental_*, offersRentals, /rentals) never change; every
   surface a provider or client reads takes its word from here. */
export const SPACES = {
  /** Sidebar item for /rentals; the admin page title follows via titleForPath. */
  nav: "Spaces",
  /** Widget group heading above the rental cards (shown only next to services). */
  widgetGroup: "Spaces",
  /** Page-builder section label + description (SECTION_META.spaces). */
  section: { label: "Spaces", description: "Your rooms, studios and gear, with photos and prices." },
  /** Onboarding mode picker. */
  pickerTitle: "Spaces",
  pickerBlurb: "Rooms, studios and gear, booked by the hour, night or day.",
  pickerBothBlurb: "You book people and spaces.",
} as const;

/** The hosted page's fallback meta description, per channel mix. */
export function bookingDescription(mode: OrgMode, orgName: string): string {
  if (mode.offersRentals && !mode.offersAppointments) return `Book a space at ${orgName}.`;
  if (mode.offersRentals && mode.offersAppointments) return `Book with ${orgName}.`;
  return `Book an appointment with ${orgName}.`;
}
