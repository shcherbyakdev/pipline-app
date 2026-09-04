export type BookingsView = "day" | "week" | "month" | "timeline";
/** `view` doubles as the label's key (`bookings.view.<view>`). */
export type ViewItem = { view: BookingsView; href: string; current: boolean };

/* Day · Week · Month, then Timeline where the org sells spaces — the same
   words from every view (admin IA spec §2). The three grids are the
   calendar's zoom levels, so they come first and in that order; the
   Timeline is a different reading of the same bookings (lanes per space,
   weeks wide) and sits after them. Week is the plain /bookings URL: it is
   the default and the one people link to.

   Every link keeps the scope (`scopeQuery` = "show=…" or empty —
   bookings-scope.ts); the timeline reads its spaces side and ignores
   people. */
export function viewSwitcherItems(input: {
  current: BookingsView;
  showTimeline: boolean;
  scopeQuery?: string;
}): ViewItem[] {
  const scoped = (base: string) =>
    input.scopeQuery ? `${base}${base.includes("?") ? "&" : "?"}${input.scopeQuery}` : base;
  const item = (view: BookingsView, base: string): ViewItem => ({
    view,
    href: scoped(base),
    current: input.current === view,
  });
  const items = [
    item("day", "/bookings?view=day"),
    item("week", "/bookings"),
    item("month", "/bookings?view=month"),
  ];
  if (input.showTimeline) items.push(item("timeline", "/bookings?view=timeline"));
  return items;
}
