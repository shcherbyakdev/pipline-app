// 2–40 chars, matches the DB CHECK on staff.slug.
export const STAFF_SLUG_RE = /^(?:[a-z0-9]{2}|[a-z0-9][a-z0-9-]{0,38}[a-z0-9])$/;

// The channel pages live at /<handle>/spaces (and /appointments is kept
// free for symmetry): Next matches those static segments before
// /[handle]/[staffSlug], so a person slugged the same would be unreachable.
export const RESERVED_STAFF_SLUGS = ["spaces", "appointments"] as const;
const RESERVED = new Set<string>(RESERVED_STAFF_SLUGS);
export function isReservedStaffSlug(slug: string): boolean {
  return RESERVED.has(slug);
}

/* Every value must keep white initials readable (>= 4.5:1 with #fff) — the
   chips in the week grid and staff switch draw white text on these. */
export const STAFF_COLORS = [
  "#4f46e5",
  "#0e7490",
  "#047857",
  // Darker than the tailwind-700/600 originals so 10px white initials hold
  // ≥4.5:1 on every swatch (2026-09-01 audit; the rest already passed).
  "#92400e",
  "#b91c1c",
  "#7c3aed",
  "#be185d",
  "#475569",
] as const;

// "Anna Müller" → "anna-muller"; "" → "team-member"; always 2–40 chars and
// matching STAFF_SLUG_RE (the DB CHECK re-enforces this — this is display
// convenience, not the sole guard).
export function slugifyStaffName(name: string): string {
  let s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  if (s === "") return "team-member";
  if (isReservedStaffSlug(s)) return `${s}-1`;
  if (s.length < 2) s = `${s}-1`;
  return s;
}

// Avatar monogram for the booking widget's staff step: first letters of the
// first two words, uppercased ("Anna Müller" → "AM"). Array.from, not [0], so
// an astral first character isn't split into half a surrogate pair.
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => Array.from(w)[0] ?? "")
    .join("")
    .toUpperCase();
}

// First unused colour, else cycles by how many are already taken.
export function nextStaffColor(used: string[]): string {
  return STAFF_COLORS.find((c) => !used.includes(c)) ?? STAFF_COLORS[used.length % STAFF_COLORS.length];
}
