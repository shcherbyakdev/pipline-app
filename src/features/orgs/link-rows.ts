import type { OrgMode } from "@/features/orgs/mode";
import type { LinkTarget } from "@/lib/booking/url";

/* Every place a client can be sent, as data (admin IA spec §5): one row per
   thing — the embed page's Show select. Pure — the page hands in ACTIVE people (only when
   the team has more than one; a solo team's link is the page), ACTIVE
   services and ACTIVE spaces, already filtered; the component turns each
   row into a link (bookingLink) and a snippet (embedSnippet). The page row
   is the org's one channel page (0073). Page rows are named by message key
   (`embed.rows.*`) and kinds by badge key (`embed.badge.*`); the component
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
  const rows: LinkRow[] = [{ key: PAGE_ROW_KEY, label: { key: "bookingPage" }, badge: null, target: null }];
  if (mode.offersRentals) {
    for (const o of input.spaces) rows.push({ key: `space:${o.id}`, label: { name: o.name }, badge: "space", target: { space: o.id } });
  }
  if (mode.offersAppointments) {
    for (const p of input.staff) rows.push({ key: `staff:${p.slug}`, label: { name: p.name }, badge: "team", target: { staff: p.slug } });
    for (const s of input.services) rows.push({ key: `service:${s.id}`, label: { name: s.name }, badge: "service", target: { service: s.id } });
  }
  return rows;
}

/* The row a deep link preselects — the Team, Service and Space pages' Embed
   links land here as ?staff=<slug>, ?service=<id> or ?space=<id>. Row keys
   are already `<kind>:<id>`, so a match is a key lookup; anything the rows
   don't list (unknown, the other channel, repeated) is the page row. */
export const PAGE_ROW_KEY = "page";

export function initialRowKey(
  rows: readonly LinkRow[],
  params: Record<string, string | string[] | undefined>,
): string {
  for (const kind of ["staff", "service", "space"] as const) {
    const value = params[kind];
    if (typeof value !== "string" || !value) continue;
    const key = `${kind}:${value}`;
    if (rows.some((r) => r.key === key)) return key;
  }
  return PAGE_ROW_KEY;
}
