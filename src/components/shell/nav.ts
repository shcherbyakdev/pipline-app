import {
  Briefcase,
  CalendarClock,
  CalendarDays,
  KeyRound,
  LayoutDashboard,
  Settings2,
  Users,
} from "lucide-react";

// Post-pivot nav (S5): Overview leads; Bookings stays the post-login surface
// (S2 user ruling). The command menu derives from this list.
export const NAV_ITEMS = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/bookings", label: "Bookings", icon: CalendarDays },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/services", label: "Services", icon: Briefcase },
  { href: "/rentals", label: "Rentals", icon: KeyRound },
  { href: "/availability", label: "Availability", icon: CalendarClock },
  { href: "/settings", label: "Settings", icon: Settings2 },
] as const;
