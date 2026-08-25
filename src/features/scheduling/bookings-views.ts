export type BookingsView = "week" | "timeline" | "list";
export type ViewItem = { view: BookingsView; label: string; href: string; current: boolean };

/* Week · Timeline · List — the same three words from every view (admin IA
   spec §2). Week always renders (a nights-only org still sees its stays as
   all-day chips there); Timeline only when a nights/days space exists. The
   week link keeps the staff lens (`staffQuery` = "staff=a,b" or empty);
   the others drop it — they have no lens. */
export function viewSwitcherItems(input: {
  current: BookingsView;
  showTimeline: boolean;
  staffQuery?: string;
}): ViewItem[] {
  const weekHref = input.staffQuery ? `/bookings?${input.staffQuery}` : "/bookings";
  const items: ViewItem[] = [{ view: "week", label: "Week", href: weekHref, current: input.current === "week" }];
  if (input.showTimeline) {
    items.push({ view: "timeline", label: "Timeline", href: "/bookings?view=timeline", current: input.current === "timeline" });
  }
  items.push({ view: "list", label: "List", href: "/bookings?view=list", current: input.current === "list" });
  return items;
}
