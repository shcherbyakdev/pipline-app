/* Every string the starter and the picker show (spec 2026-08-28 §5). Kept
   out of the components so copy.test.ts can guard it the way site.test.ts
   guards the funnel: no "rental", no "offering", no skip. The "Something
   else" cards and the per-type words live in business-types.ts. */
export const STARTER = {
  title: "What kind of business is this?",
  sub: "Pick the closest match — your page starts from a layout that fits, and you can change everything after.",
  look: "Also apply this look (theme, font, corners)",
  lookHint: "Unlike the sections, this changes the live page and website embed immediately.",
  firstService: {
    title: "Add your first service",
    sub: "It goes straight onto your page. Add more on Services whenever you like.",
    name: "Name",
    namePlaceholder: "e.g. Haircut",
    duration: "Duration",
    price: "Price (optional)",
    pricePlaceholder: (currency: string) => `e.g. 120 ${currency}`,
    submit: "Add service",
  },
  firstSpace: {
    title: "Add your first space",
    sub: "It goes straight onto your page, with one unit. Add more on Spaces whenever you like.",
    name: "Name",
    namePlaceholder: "e.g. Studio A",
    bookedBy: "Booked by",
    hours: "the hour",
    nights: "the night",
    days: "the day",
    price: (per: string, currency: string) => `Price per ${per} (${currency}, optional)`,
    submit: "Add space",
  },
  back: "Back",
  picker: {
    trigger: "Start from a template",
    title: "Start from a template",
    sub: "Pick the closest match, then make it yours. Your published page stays until you publish.",
  },
  replace: {
    title: "Replace your current draft?",
    description: "Your published page stays until you publish.",
    confirm: "Replace",
  },
  applied: "Template applied",
} as const;
