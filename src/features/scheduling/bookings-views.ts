export type BookingsView = "week" | "timeline" | "list";
export type ViewItem = { view: BookingsView; label: string; href: string; current: boolean };

/* Week · Timeline · List — the same three words from every view (admin IA
   spec §2). Week always renders (a nights-only org still sees its stays as
   all-day chips there); Timeline only when a nights/days space exists. Week
   and List keep the scope (`scopeQuery` = "show=…" or empty — bookings-
   scope.ts); the Timeline drops it — it is spaces by nature. */
export function viewSwitcherItems(input: {
  current: BookingsView;
  showTimeline: boolean;
  scopeQuery?: string;
}): ViewItem[] {
  const scoped = (base: string) =>
    input.scopeQuery ? `${base}${base.includes("?") ? "&" : "?"}${input.scopeQuery}` : base;
  const items: ViewItem[] = [{ view: "week", label: "Week", href: scoped("/bookings"), current: input.current === "week" }];
  if (input.showTimeline) {
    items.push({ view: "timeline", label: "Timeline", href: "/bookings?view=timeline", current: input.current === "timeline" });
  }
  items.push({ view: "list", label: "List", href: scoped("/bookings?view=list"), current: input.current === "list" });
  return items;
}
