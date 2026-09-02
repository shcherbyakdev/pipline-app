/* The rentals channel's name for people (H5a ruling: "Spaces" — rooms,
   studios and gear alike, whatever the range mode). Code identifiers
   (rental_*, offersRentals, /rentals) never change.

   The admin (i18n Wave 3) and the studio + embed (Wave 4) read messages
   (`spaces.*`, `studio.*`, `embed.*`). What is left here is read by the
   landing page — the demo widget and the onboarding mode copy in
   marketing/site.ts — and moves to messages with Wave 5; then this file goes. */
export const SPACES = {
  /** Group heading above the space cards in the landing's demo widget. */
  widgetGroup: "Spaces",
  /** Onboarding mode picker (site.ts ONBOARDING.modes). */
  pickerTitle: "Spaces",
  pickerBlurb: "Rooms, studios and gear, booked by the hour, night or day.",
  pickerBothBlurb: "You book spaces and people.",
} as const;
