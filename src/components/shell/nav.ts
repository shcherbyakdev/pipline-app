import { CalendarClock, Briefcase, Settings2 } from "lucide-react";

// Scheduling pivot (2026-08-13 spec): the fire-safety features (programs,
// templates, clients) are legacy — code and routes kept, nav removed.
// Bookings joins in S2, Widget in S3, Clients directory returns in S5.
export const NAV_ITEMS = [
  { href: "/services", label: "Services", icon: Briefcase },
  { href: "/availability", label: "Availability", icon: CalendarClock },
  { href: "/settings", label: "Settings", icon: Settings2 },
] as const;
