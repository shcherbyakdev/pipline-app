export type BookingsView = "week" | "timeline" | "list";
/** `view` doubles as the label's key (`bookings.view.<view>`). */
export type ViewItem = { view: BookingsView; href: string; current: boolean };

/* Week · Timeline · List — the same three words from every view (admin IA
   spec §2). Week always renders (a nights-only org still sees its stays as
   all-day chips there); Timeline whenever the org has a space (v2 puts
   hourly rooms on it too). Every link keeps the scope (`scopeQuery` =
   "show=…" or empty — bookings-scope.ts); the timeline reads its spaces
   side and ignores people. */
export function viewSwitcherItems(input: {
  current: BookingsView;
  showTimeline: boolean;
  scopeQuery?: string;
}): ViewItem[] {
  const scoped = (base: string) =>
    input.scopeQuery ? `${base}${base.includes("?") ? "&" : "?"}${input.scopeQuery}` : base;
  const items: ViewItem[] = [{ view: "week", href: scoped("/bookings"), current: input.current === "week" }];
  if (input.showTimeline) {
    items.push({ view: "timeline", href: scoped("/bookings?view=timeline"), current: input.current === "timeline" });
  }
  items.push({ view: "list", href: scoped("/bookings?view=list"), current: input.current === "list" });
  return items;
}
