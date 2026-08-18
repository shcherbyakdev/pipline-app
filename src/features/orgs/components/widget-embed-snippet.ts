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
export function snippetFor(appUrl: string, handle: string, staffSlug?: string | null): string {
  const src = staffSlug ? `${appUrl}/embed/${handle}?staff=${staffSlug}` : `${appUrl}/embed/${handle}`;
  return (
    `<iframe data-rollout-embed src="${src}" `
    + `style="width:100%;border:0" title="Book an appointment"></iframe>\n`
    + `<script src="${appUrl}/embed.js" async></script>`
  );
}
