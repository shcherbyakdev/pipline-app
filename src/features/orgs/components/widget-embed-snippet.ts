import type { OrgMode } from "@/features/orgs/mode";

// Pure string builder, split out of widget-appearance.tsx so it's
// unit-testable without pulling in that "use client" component's React /
// next/font dependency graph (vitest's test.include only covers *.test.ts,
// not *.tsx).
//
// Shape mirrors the spec's snippet block verbatim (design doc, "Snippet
// UI"): `data-rollout-embed` is load-bearing — public/embed.js selects
// iframes via `iframe[data-rollout-embed]` — and `async` on the script tag
// keeps the pasted snippet from parser-blocking the customer's page.
//
// `staffSlug` pins the embed to one team member (`/embed/<handle>?staff=…`);
// omitting it keeps the whole-team flow, and the string is byte-identical to
// what solo orgs have always pasted.
//
// The iframe `title` is the widget's accessible name on the host page — it
// follows the org's channels (embedTitle) so a space owner's site doesn't
// announce "Book an appointment". Omitting `mode` keeps the historical
// appointments title.
export function embedTitle(mode?: OrgMode): string {
  if (!mode || (mode.offersAppointments && !mode.offersRentals)) return "Book an appointment";
  return mode.offersRentals && !mode.offersAppointments ? "Book a space" : "Book online";
}

export function snippetFor(
  appUrl: string,
  handle: string,
  staffSlug?: string | null,
  mode?: OrgMode,
): string {
  const src = staffSlug ? `${appUrl}/embed/${handle}?staff=${staffSlug}` : `${appUrl}/embed/${handle}`;
  return (
    `<iframe data-rollout-embed src="${src}" `
    + `style="width:100%;border:0" title="${embedTitle(mode)}"></iframe>\n`
    + `<script src="${appUrl}/embed.js" async></script>`
  );
}
