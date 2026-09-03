import type { OrgMode } from "@/features/orgs/mode";
import type { LinkTarget } from "@/lib/booking/url";

/* The Links & embeds table as data (admin IA spec §5): one row per thing a
   client can be sent to. Pure — the page hands in ACTIVE people (only when
   the team has more than one; a solo team's link is the page), ACTIVE
   services and ACTIVE spaces, already filtered; the component turns each
   row into a link (bookingLink) and a snippet (embedSnippet). The page row
   is the org's one channel page (0073). Page rows are named by message key
   (`embed.rows.*`) and kinds by badge key (`embed.badge.*`); the table
   translates, this stays locale-free. */
export type LinkRow = {
  key: string;
  label: { key: "bookingPage" } | { name: string };
  badge: "space" | "team" | "service" | null;
  target: LinkTarget;
};

export function linkRows(input: {
  mode: OrgMode;
  staff: readonly { slug: string; name: string }[];
  services: readonly { id: string; name: string }[];
  spaces: readonly { id: string; name: string }[];
}): LinkRow[] {
  const { mode } = input;
  const rows: LinkRow[] = [{ key: "page", label: { key: "bookingPage" }, badge: null, target: null }];
  if (mode.offersRentals) {
    for (const o of input.spaces) rows.push({ key: `space:${o.id}`, label: { name: o.name }, badge: "space", target: { space: o.id } });
  }
  if (mode.offersAppointments) {
    for (const p of input.staff) rows.push({ key: `staff:${p.slug}`, label: { name: p.name }, badge: "team", target: { staff: p.slug } });
    for (const s of input.services) rows.push({ key: `service:${s.id}`, label: { name: s.name }, badge: "service", target: { service: s.id } });
  }
  return rows;
}
