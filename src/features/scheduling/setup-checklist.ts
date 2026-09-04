import type { OrgMode } from "@/features/orgs/mode";

/* The welcome banner's setup chips (admin IA spec §4). Pure: the Bookings
   page gathers the counts on every load until the list is done, and every
   tick is derived from data that already exists. Nothing about progress is
   persisted; the one thing that is — a dismissal — lives in a cookie
   (SETUP_DISMISSED_COOKIE), not the database. */
export type ChecklistInput = {
  mode: OrgMode;
  serviceCount: number;      // active services
  spaceCount: number;        // active spaces (rental offerings)
  bookableSpaceCount: number; // of those, with ≥1 active unit — the only ones the public page lists (listPublicOfferings)
  unitlessSpaceId: string | null; // first active space with no active unit — where the chip sends the owner
  hourlySpaceCount: number;  // of those, booked by the hour — they set weekly hours on /availability (U3)
  ownersWithHours: number;   // team members or hourly spaces with ≥1 weekly rule
};

/** `bookings.checklist.*` keys (messages/en.json); the banner renders them. */
export type ChecklistLabelKey = "addSpace" | "addUnit" | "addService" | "setHours";

export type ChecklistItem = {
  id: "service" | "space" | "hours";
  labelKey: ChecklistLabelKey;
  href: string;
  done: boolean;
};

export function setupChecklist(i: ChecklistInput): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  if (i.mode.offersRentals) {
    // A space counts once it is bookable: the public page (D9) 404s until
    // some space has an active unit, so ticking on the offering alone told
    // the owner they were live while their address was a 404.
    const bookable = i.bookableSpaceCount > 0;
    const needsUnit = !bookable && i.unitlessSpaceId !== null;
    items.push({
      id: "space",
      labelKey: needsUnit ? "addUnit" : "addSpace",
      href: needsUnit ? `/rentals/${i.unitlessSpaceId}` : "/rentals/new",
      done: bookable,
    });
  }
  if (i.mode.offersAppointments) {
    items.push({ id: "service", labelKey: "addService", href: "/services?new=1", done: i.serviceCount > 0 });
  }
  // Hours exist for team members and hourly spaces (spec §3, ruling 4);
  // a nights/days-only org sets check-in/out times on the space instead.
  if (i.mode.offersAppointments || i.hourlySpaceCount > 0) {
    items.push({ id: "hours", labelKey: "setHours", href: "/availability", done: i.ownersWithHours > 0 });
  }
  // No "publish" chip: /[handle] renders a default page document the moment
  // the catalogue has something bookable (renderChannelPage), so the chips
  // above ARE the go-live conditions — a publish chip claimed the page was
  // off while it was already live (honest-tick rule). Builder publishing
  // only swaps default content for customised content.
  return items;
}

/** Dismissal cookie (setup-actions.ts writes it, the Bookings page reads
    it). Value = the org id, so a jar left over from another org's session
    on the same browser does not hide a fresh org's banner. A cookie rather
    than a column: `orgs` is select-only for authenticated (0004), so a
    persisted flag would mean a migration plus a definer RPC for a hint
    that hides itself the moment setup is finished. */
export const SETUP_DISMISSED_COOKIE = "booklo_setup_dismissed";
export const SETUP_DISMISSED_MAX_AGE = 365 * 24 * 60 * 60;

/** Whether the Bookings page shows the welcome banner. It used to ride
    ?welcome=1 and vanished on the first click of any chip (every chip
    navigates away, and the week arrows rebuild the URL without it); now
    it stays until the checklist is complete or the owner dismisses it. A
    handle-less org (pre-0051) has no chips but still needs the "pick an
    address" prompt. */
export function showWelcome(i: { dismissed: boolean; handle: string | null; checklist: ChecklistItem[] }): boolean {
  if (i.dismissed) return false;
  if (i.handle === null) return true;
  return i.checklist.some((item) => !item.done);
}
