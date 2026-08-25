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

  // ---- admin surfaces (admin IA spec 2026-08-25 §1). "Offering" and
  // "rental" never reach a provider's eyes; the code keeps its identifiers.
  one: "space",
  newButton: "New space",
  dialogTitle: { new: "New space", edit: "Edit space" },
  /** Back link on the space detail page. */
  back: "← Spaces",
  /** /rentals list with nothing in it. */
  empty:
    "No spaces yet — a space is a room, studio or item clients book by the hour, night or day. Add one, then add its units.",
  /** One muted line above the units editor. */
  unitsHint: "Units are the individual rooms or items a client is assigned — one per room.",
  unitsEmpty: "No units yet — the space won't appear on your booking page until it has an active unit.",
  /** Label of the walk-in dialog's picker when only spaces are listed. */
  field: "Space",
  /** Bookings-page walk-in button + its dialog title (U2 folds both into "New booking"). */
  walkIn: "New space booking",
  /** ⌘K action. */
  command: "New space",
  /** Settings › Business row. */
  settings: { label: "Spaces", blurb: "Rooms, studios and gear, booked by the hour, night or day." },
  /** Welcome checklist item + Bookings empty state. */
  add: "Add a space",
} as const;

/** The appointments channel's few provider-facing words that sit next to
    SPACES' (Settings row, welcome checklist). */
export const APPOINTMENTS = {
  settings: { label: "Appointments", blurb: "Services booked as time slots with your team." },
  add: "Add a service",
} as const;

/** The hosted page's fallback meta description, per channel mix. */
export function bookingDescription(mode: OrgMode, orgName: string): string {
  if (mode.offersRentals && !mode.offersAppointments) return `Book a space at ${orgName}.`;
  if (mode.offersRentals && mode.offersAppointments) return `Book with ${orgName}.`;
  return `Book an appointment with ${orgName}.`;
}
