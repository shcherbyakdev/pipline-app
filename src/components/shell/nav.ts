import { Briefcase, CalendarClock, CalendarDays, Settings2 } from "lucide-react";

// Post-pivot nav (S2): Bookings is the daily surface. Widget joins in S3,
// Clients directory returns in S5.
export const NAV_ITEMS = [
  { href: "/bookings", label: "Bookings", icon: CalendarDays },
  { href: "/services", label: "Services", icon: Briefcase },
  { href: "/availability", label: "Availability", icon: CalendarClock },
  { href: "/settings", label: "Settings", icon: Settings2 },
] as const;
