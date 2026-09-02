/* The rentals channel's name for people (H5a ruling: "Spaces" — rooms,
   studios and gear alike, whatever the range mode). Code identifiers
   (rental_*, offersRentals, /rentals) never change.

   i18n Wave 3 moved the admin words into messages (`spaces.*` and
   `appointments.*`, same key names); what is left here is read by surfaces
   later waves translate — the studio and its links table (Wave 4), the
   landing page's demo widget and the onboarding mode copy in site.ts
   (Wave 5). Each moves to messages with its surface and this file goes. */
export const SPACES = {
  /** Group heading above the space cards in the admin's and the landing's demo widgets. */
  widgetGroup: "Spaces",
  /** Page-builder section label + description (SECTION_META.spaces). */
  section: { label: "Spaces", description: "Your rooms, studios and gear, with photos and prices." },
  /** Onboarding mode picker (site.ts ONBOARDING.modes). */
  pickerTitle: "Spaces",
  pickerBlurb: "Rooms, studios and gear, booked by the hour, night or day.",
  pickerBothBlurb: "You book spaces and people.",
  /** Kind badge in the links table. */
  badge: "Space",
  /** The builder's page switch (studio/page-switch.tsx) and the links table. */
  page: "Spaces page",
} as const;

export const APPOINTMENTS = {
  /** The builder's page switch for a both-channel org. */
  page: "Appointments page",
} as const;
