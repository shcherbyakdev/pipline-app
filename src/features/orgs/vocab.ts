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
  /** Timeline view with no spaces; followed by a link whose text is SPACES.nav. */
  timelineEmpty: "No spaces yet — add a space and its units under",
  /** One muted line above the units editor. */
  unitsHint: "Units are the individual rooms or items a client is assigned — one per room.",
  unitsEmpty: "No units yet — the space won't appear on your booking page until it has an active unit.",
  /** The New-booking picker's label when only spaces are listed. */
  field: "Space",
  /** The New-booking picker's label when both services and spaces are listed. */
  pickerBoth: "Service or space",
  /** Kind badge on list rows, client history and the week grid (sr-only). */
  badge: "Space",
  /** Toolbar chip when a staff lens hides space bookings from the week. */
  hidden: (n: number) => `${n} space booking${n === 1 ? "" : "s"} hidden`,
  /** ⌘K action. */
  command: "New space",
  /** Settings › Business row. */
  settings: { label: "Spaces", blurb: "Rooms, studios and gear, booked by the hour, night or day." },
  /** Welcome checklist item + Bookings empty state. */
  add: "Add a space",
  // ---- /availability (admin IA spec §3, ruling 4: hours are edited in one
  // place for people and hourly spaces; nightly/daily spaces have none).
  /** Second intro line when a space's hours are on screen and the org also has nightly/daily spaces. */
  hoursNote: "Nightly and daily spaces use check-in and check-out times instead — set those on the space.",
  /** The page with nothing to edit (a nights/days-only org); followed by a link whose text is SPACES.nav. */
  hoursNightsOnly:
    "Nightly and daily spaces use check-in and check-out times, set on each space. Hourly spaces and team members set their weekly hours here.",
  /** Links & embeds row: the widget restricted to this channel (?channel=spaces). */
  only: "Spaces only",
} as const;

/** The appointments channel's few provider-facing words that sit next to
    SPACES' (Settings row, welcome checklist). */
export const APPOINTMENTS = {
  settings: { label: "Appointments", blurb: "Services booked as time slots with your team." },
  add: "Add a service",
  /** The New-booking picker's label when only services are listed. */
  field: "Service",
  /** Links & embeds row: the widget restricted to this channel (?channel=services). */
  only: "Appointments only",
} as const;

/** The hosted page's fallback meta description, per channel mix. */
export function bookingDescription(mode: OrgMode, orgName: string): string {
  if (mode.offersRentals && !mode.offersAppointments) return `Book a space at ${orgName}.`;
  if (mode.offersRentals && mode.offersAppointments) return `Book with ${orgName}.`;
  return `Book an appointment with ${orgName}.`;
}
