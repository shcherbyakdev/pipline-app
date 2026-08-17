import {
  Briefcase,
  CalendarClock,
  CalendarDays,
  LayoutDashboard,
  Settings2,
  Users,
} from "lucide-react";

// Post-pivot nav (S5): Overview leads; Bookings stays the post-login surface
// (S2 user ruling). The command menu derives from this list. `section` splits
// the sidebar Linear-style: day-to-day views on top, then a labelled
// "Configure" group for the things you set up once.
export const NAV_ITEMS = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard, section: "main" },
  { href: "/bookings", label: "Bookings", icon: CalendarDays, section: "main" },
  { href: "/clients", label: "Clients", icon: Users, section: "main" },
  { href: "/services", label: "Services", icon: Briefcase, section: "configure" },
  { href: "/availability", label: "Availability", icon: CalendarClock, section: "configure" },
  { href: "/settings", label: "Settings", icon: Settings2, section: "configure" },
] as const;

export const NAV_SECTION_LABELS = { main: null, configure: "Configure" } as const;

/** Title for the top bar: the matching nav label, else the first path
    segment capitalised (e.g. /rentals → "Rentals"). */
export function titleForPath(pathname: string): string {
  const hit = NAV_ITEMS.find((i) => pathname === i.href || pathname.startsWith(i.href + "/"));
  if (hit) return hit.label;
  const seg = pathname.split("/").filter(Boolean)[0] ?? "";
  return seg ? seg.charAt(0).toUpperCase() + seg.slice(1) : "";
}
