import {
  Briefcase01Icon,
  Calendar03Icon,
  Clock01Icon,
  CreditCardIcon,
  DashboardSquare01Icon,
  Globe02Icon,
  House01Icon,
  Notification03Icon,
  PlugSocketIcon,
  Settings01Icon,
  SourceCodeIcon,
  UserGroupIcon,
  UserMultipleIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import type { Flags } from "@/lib/flags";
import type { Channel, OrgMode } from "@/features/orgs/mode";
import type en from "../../../messages/en.json";

// Post-pivot nav (S5): Bookings leads and stays the post-login surface (S2
// user ruling). The command menu derives from this list. `section` splits
// the sidebar Linear-style (admin IA spec 2026-08-25 §1): day-to-day views
// on top, then "Offer" (what the org sells — Spaces, Services, Team,
// Availability), then "Share" (where clients book — the two channels), then
// an unlabelled account group (Billing, Settings). The order is fixed
// regardless of mode, spaces first (H5b ruling 1): a single-mode org loses
// rows, it never reorders. Settings holds only admin-panel preferences plus
// the org's "what you offer" group (R3 relaxation of the 2026-08-17 ruling).
// Icons are Hugeicons stroke-rounded (free set) — render with
// <HugeiconsIcon icon={…} />.
export type NavSection = "main" | "offer" | "share" | "account";

/** Sidebar render order. The sidebar iterates this, so a section added here
    cannot be forgotten there. */
export const NAV_SECTIONS: readonly NavSection[] = ["main", "offer", "share", "account"];

/** `shell.section.*` keys (messages/en.json); null = unlabelled group. */
export const NAV_SECTION_LABELS: Record<NavSection, "offer" | "share" | null> = {
  main: null,
  offer: "offer",
  share: "share",
  account: null,
};

/** The words live in messages (`shell.nav.*`, i18n Wave 3); items carry the key. */
export type NavLabelKey = keyof typeof en.shell.nav;

export type NavItem = {
  href: string;
  labelKey: NavLabelKey;
  icon: IconSvgElement;
  section: NavSection;
  /** Set when the item belongs to one booking channel; omitted = always
      shown. navItemsFor filters on it. */
  channel?: Channel;
};

const ALL_NAV_ITEMS: readonly NavItem[] = [
  // Shown only when the org's `overview` flag resolves true (lib/flags).
  { href: "/overview", labelKey: "overview", icon: DashboardSquare01Icon, section: "main" },
  { href: "/bookings", labelKey: "bookings", icon: Calendar03Icon, section: "main" },
  { href: "/clients", labelKey: "clients", icon: UserMultipleIcon, section: "main" },
  { href: "/rentals", labelKey: "spaces", icon: House01Icon, section: "offer", channel: "rentals" },
  { href: "/services", labelKey: "services", icon: Briefcase01Icon, section: "offer", channel: "appointments" },
  // Always present, solo or not: a solo provider sees one row (themselves).
  { href: "/team", labelKey: "team", icon: UserGroupIcon, section: "offer", channel: "appointments" },
  // No channel: it stays for every mode — hours for people AND hourly
  // spaces are edited there (U3); a nights/days-only org gets an
  // explanatory empty state, never a redirect.
  { href: "/availability", labelKey: "availability", icon: Clock01Icon, section: "offer" },
  { href: "/booking-page", labelKey: "bookingPage", icon: Globe02Icon, section: "share" },
  { href: "/embed", labelKey: "embed", icon: SourceCodeIcon, section: "share" },
  // Shown only when the org's `billing` flag resolves true; the route 404s
  // in the same world.
  { href: "/billing", labelKey: "billing", icon: CreditCardIcon, section: "account" },
  // What the person hears about (email, push) and what clients receive
  // (reminders) — its own page, not a Settings section (spec 2026-09-05).
  { href: "/notifications", labelKey: "notifications", icon: Notification03Icon, section: "account" },
  // Connected apps — Google Calendar today (spec 2026-09-05 §2.12).
  { href: "/integrations", labelKey: "integrations", icon: PlugSocketIcon, section: "account" },
  { href: "/settings", labelKey: "settings", icon: Settings01Icon, section: "account" },
];

/** What the sidebar and the command menu render for an org. One list, one
    filter: a dormant feature or a channel the org doesn't sell must not
    leave a dead link in either. The dashboard layout resolves flags and
    mode once and passes both down. */
export function navItemsFor(flags: Pick<Flags, "billing" | "overview" | "rentals">, mode: OrgMode): NavItem[] {
  return ALL_NAV_ITEMS.filter((i) => {
    if (i.href === "/billing" && !flags.billing) return false;
    if (i.href === "/overview" && !flags.overview) return false;
    if (i.channel === "appointments" && !mode.offersAppointments) return false;
    if (i.channel === "rentals" && !(flags.rentals && mode.offersRentals)) return false;
    return true;
  });
}

/** Title for the top bar: the matching nav item's key (the caller renders
    `shell.nav.<key>`), else the first path segment capitalised as plain text
    (e.g. /rentals → "Rentals" while the rentals channel is off). */
export function titleForPath(pathname: string, items: readonly NavItem[]): { key: NavLabelKey } | { text: string } {
  const hit = items.find((i) => pathname === i.href || pathname.startsWith(i.href + "/"));
  if (hit) return { key: hit.labelKey };
  const seg = pathname.split("/").filter(Boolean)[0] ?? "";
  return { text: seg ? seg.charAt(0).toUpperCase() + seg.slice(1) : "" };
}
