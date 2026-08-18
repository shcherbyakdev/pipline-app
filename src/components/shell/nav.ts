import {
  Briefcase01Icon,
  Calendar03Icon,
  Clock01Icon,
  CreditCardIcon,
  Globe02Icon,
  Settings01Icon,
  SourceCodeIcon,
  UserGroupIcon,
  UserMultipleIcon,
} from "@hugeicons/core-free-icons";
import { BILLING_ENABLED } from "@/lib/flags";

// Post-pivot nav (S5): Bookings leads and stays the post-login surface (S2
// user ruling). The command menu derives from this list. `section` splits
// the sidebar Linear-style: day-to-day views on top, then a labelled
// "Configure" group for the things you set up once. The two booking channels
// (hosted Booking page, Website embed) are first-class here, Calendly-style;
// Settings holds only admin-panel preferences (user ruling 2026-08-17). Icons are Hugeicons
// stroke-rounded (free set) — render with <HugeiconsIcon icon={…} />.
const ALL_NAV_ITEMS = [
  // Overview is parked (OVERVIEW_ENABLED, lib/flags.ts) — restore its row here
  // as the first "main" item when un-parking.
  { href: "/bookings", label: "Bookings", icon: Calendar03Icon, section: "main" },
  { href: "/clients", label: "Clients", icon: UserMultipleIcon, section: "main" },
  { href: "/services", label: "Services", icon: Briefcase01Icon, section: "configure" },
  // Always present, solo or not: a solo provider sees one row (themselves).
  { href: "/team", label: "Team", icon: UserGroupIcon, section: "configure" },
  { href: "/availability", label: "Availability", icon: Clock01Icon, section: "configure" },
  { href: "/booking-page", label: "Booking page", icon: Globe02Icon, section: "configure" },
  { href: "/embed", label: "Website embed", icon: SourceCodeIcon, section: "configure" },
  // Org-level, so it sits in Configure next to the other org nouns — Settings
  // stays per-user (IA ruling 2026-08-17). Filtered out below until the
  // billing flag flips; the route 404s in the same world.
  { href: "/billing", label: "Billing", icon: CreditCardIcon, section: "configure" },
  { href: "/settings", label: "Settings", icon: Settings01Icon, section: "configure" },
] as const;

/** What the sidebar and the command menu render. One list, one filter: a
    dormant feature must not leave a dead link in either. */
export const NAV_ITEMS = ALL_NAV_ITEMS.filter((i) => i.href !== "/billing" || BILLING_ENABLED);

export const NAV_SECTION_LABELS = { main: null, configure: "Configure" } as const;

/** Title for the top bar: the matching nav label, else the first path
    segment capitalised (e.g. /rentals → "Rentals"). */
export function titleForPath(pathname: string): string {
  const hit = NAV_ITEMS.find((i) => pathname === i.href || pathname.startsWith(i.href + "/"));
  if (hit) return hit.label;
  const seg = pathname.split("/").filter(Boolean)[0] ?? "";
  return seg ? seg.charAt(0).toUpperCase() + seg.slice(1) : "";
}
