// Pure string builder, split out of widget-appearance.tsx so it's
// unit-testable without pulling in that "use client" component's React /
// next/font dependency graph (vitest's test.include only covers *.test.ts,
// not *.tsx).
//
// Shape mirrors the spec's snippet block verbatim (design doc, "Snippet
// UI"): `data-rollout-embed` is load-bearing — public/embed.js selects
// iframes via `iframe[data-rollout-embed]` — and `async` on the script tag
// keeps the pasted snippet from parser-blocking the customer's page.
export function snippetFor(appUrl: string, handle: string): string {
  return (
    `<iframe data-rollout-embed src="${appUrl}/embed/${handle}" `
    + `style="width:100%;border:0" title="Book an appointment"></iframe>\n`
    + `<script src="${appUrl}/embed.js" async></script>`
  );
}
