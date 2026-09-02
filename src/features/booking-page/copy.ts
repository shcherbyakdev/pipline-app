/* Every string the starter and the picker show (widget templates spec
   2026-09-02 §5). Kept out of the components so copy.test.ts can guard it
   the way site.test.ts guards the funnel: no "rental", no "offering", no
   skip. The layout cards' words live in WIDGET_LAYOUT_OPTIONS. */
export const STARTER = {
  title: "How should clients pick a time?",
  titleSpaces: "How should clients pick dates and times?",
  sub: "Pick how this page's widget shows what is free. It applies straight away, and you can change it any time on Settings.",
  firstService: {
    title: "Add your first service",
    sub: "It goes straight onto your page. Add more on Services whenever you like.",
    why: "A layout needs at least one service to show — add one and the page fills in.",
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
    why: "A layout needs at least one bookable space to show — add one and the page fills in.",
    name: "Name",
    namePlaceholder: "e.g. Studio A",
    bookedBy: "Booked by",
    hours: "the hour",
    nights: "the night",
    days: "the day",
    price: (per: string, currency: string) => `Price per ${per} (${currency}, optional)`,
    submit: "Add space",
    noticeHint: "The page can list this space once it has a unit — add one on Spaces. You can keep going and publish when it is bookable.",
  },
  back: "Back",
  leave: "Leave for now",
  continue: "Continue",
  picker: {
    trigger: "Widget layout",
    title: "Widget layout",
    sub: "Change how this page shows what is free. It applies straight away; the website embed has its own layout.",
    use: "Use this layout",
  },
  applied: "Widget layout saved",
} as const;
