import type { OrgMode } from "@/features/orgs/mode";
import { embedSrc, type LinkTarget } from "@/lib/booking/url";

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
// The `target` (admin IA spec §5) pins the embed to one person, one
// service, one space or one channel — `embedSrc` builds the query. A null
// target is the whole-catalogue embed, byte-identical to what solo orgs
// have always pasted.
//
// The iframe `title` is the widget's accessible name on the host page. With
// a target it names that target's channel; without one it follows the org's
// channels (embedTitle), and omitting `mode` keeps the historical
// appointments title.
export function embedTitle(mode?: OrgMode): string {
  if (!mode || (mode.offersAppointments && !mode.offersRentals)) return "Book an appointment";
  return mode.offersRentals && !mode.offersAppointments ? "Book a space" : "Book online";
}

function snippetTitle(target: LinkTarget | undefined, mode: OrgMode | undefined): string {
  if (target && ("space" in target || ("channel" in target && target.channel === "spaces"))) return "Book a space";
  if (target) return "Book an appointment";
  return embedTitle(mode);
}

export function embedSnippet(appUrl: string, handle: string, target?: LinkTarget, mode?: OrgMode): string {
  const scriptBase = appUrl.replace(/\/+$/, "");
  return (
    `<iframe data-rollout-embed src="${embedSrc(appUrl, handle, target)}" `
    + `style="width:100%;border:0" title="${snippetTitle(target, mode)}"></iframe>\n`
    + `<script src="${scriptBase}/embed.js" async></script>`
  );
}
