import type { OrgMode } from "@/features/orgs/mode";
import { APPOINTMENTS, SPACES } from "@/features/orgs/vocab";
import { WELCOME } from "@/features/marketing/site";

/* The welcome banner's setup chips (admin IA spec §4). Pure: the Bookings
   page gathers the counts only under ?welcome=1 and nothing is persisted —
   every tick is derived from data that already exists. */
export type ChecklistInput = {
  mode: OrgMode;
  serviceCount: number;      // active services
  spaceCount: number;        // active spaces (rental offerings)
  bookableSpaceCount: number; // of those, with ≥1 active unit — the only ones the public page lists (listPublicOfferings)
  unitlessSpaceId: string | null; // first active space with no active unit — where the chip sends the owner
  hourlySpaceCount: number;  // of those, booked by the hour — they set weekly hours on /availability (U3)
  ownersWithHours: number;   // team members or hourly spaces with ≥1 weekly rule
  published: boolean;        // booking page has a published document
};

export type ChecklistItem = {
  id: "service" | "space" | "hours" | "publish";
  label: string;
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
      label: needsUnit ? SPACES.addUnit : SPACES.add,
      href: needsUnit ? `/rentals/${i.unitlessSpaceId}` : "/rentals?new=1",
      done: bookable,
    });
  }
  if (i.mode.offersAppointments) {
    items.push({ id: "service", label: APPOINTMENTS.add, href: "/services?new=1", done: i.serviceCount > 0 });
  }
  // Hours exist for team members and hourly spaces (spec §3, ruling 4);
  // a nights/days-only org sets check-in/out times on the space instead.
  if (i.mode.offersAppointments || i.hourlySpaceCount > 0) {
    items.push({ id: "hours", label: WELCOME.setHours, href: "/availability", done: i.ownersWithHours > 0 });
  }
  items.push({ id: "publish", label: WELCOME.publish, href: "/booking-page", done: i.published });
  return items;
}
