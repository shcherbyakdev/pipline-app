import type { OrgMode } from "@/features/orgs/mode";
import { APPOINTMENTS, SPACES } from "@/features/orgs/vocab";
import type { LinkTarget } from "@/lib/booking/url";

/* The Links & embeds table as data (admin IA spec §5): one row per thing a
   client can be sent to. Pure — the page hands in ACTIVE people (only when
   the team has more than one; a solo team's link is the page), ACTIVE
   services and ACTIVE spaces, already filtered; the component turns each
   row into a link (bookingLink) and a snippet (embedSnippet). A
   both-channel org gets one row per channel page and never a whole-
   catalogue row: an embed is one channel (2026-09-02 ruling), like a page. */
export type LinkRow = { key: string; label: string; badge: string | null; target: LinkTarget };

export function linkRows(input: {
  mode: OrgMode;
  staff: readonly { slug: string; name: string }[];
  services: readonly { id: string; name: string }[];
  spaces: readonly { id: string; name: string }[];
}): LinkRow[] {
  const { mode } = input;
  const rows: LinkRow[] =
    mode.offersAppointments && mode.offersRentals
      ? [
          { key: "channel:services", label: APPOINTMENTS.page, badge: null, target: { channel: "services" } },
          { key: "channel:spaces", label: SPACES.page, badge: null, target: { channel: "spaces" } },
        ]
      : [{ key: "page", label: "Booking page", badge: null, target: null }];
  if (mode.offersRentals) {
    for (const o of input.spaces) rows.push({ key: `space:${o.id}`, label: o.name, badge: SPACES.badge, target: { space: o.id } });
  }
  if (mode.offersAppointments) {
    for (const p of input.staff) rows.push({ key: `staff:${p.slug}`, label: p.name, badge: "Team", target: { staff: p.slug } });
    for (const s of input.services) rows.push({ key: `service:${s.id}`, label: s.name, badge: "Service", target: { service: s.id } });
  }
  return rows;
}
