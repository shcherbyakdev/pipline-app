export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  // No wrapper element, no padding here — sizing/padding and the actual
  // widget background live inside WidgetTheme (see [handle]/page.tsx) so
  // --widget-bg covers exactly the content, not the full iframe viewport.
  //
  // The scoped <style> below does two things for /embed routes only:
  //
  // 1. `background: transparent` — the root layout hardcodes dark mode on
  //    <html>, and WidgetTheme no longer has min-h-dvh (see [handle]/page.tsx
  //    for why), so there's a brief window before embed.js's first resize
  //    message where the iframe is taller than WidgetTheme's content —
  //    without this, that gap would paint as a dark frame instead of letting
  //    the host page's own background show through, which is the standard
  //    behavior for embedded widgets.
  //
  // 2. `height: auto; min-height: 0` — the root layout's <html> is `h-full`
  //    and <body> is `min-h-full` (100%). Inside an iframe, a percentage
  //    height resolves against the iframe's CURRENT height (whatever
  //    embed.js last set), not its content — so even with min-h-dvh gone
  //    from WidgetTheme, body still stretched to fill that inherited 100%
  //    floor and body.offsetHeight could never read below it. This breaks
  //    that percentage chain so body's box — and therefore offsetHeight —
  //    tracks content size in both directions, which is what actually lets
  //    EmbedResizeReporter's shrink fix take effect.
  //
  // Unlayered rules beat Tailwind's layered h-full/min-h-full utilities
  // regardless of source order or specificity (same mechanism the
  // .widget-theme overrides in globals.css rely on).
  return (
    <>
      <style>{"html, body { height: auto; min-height: 0; background: transparent }"}</style>
      {children}
    </>
  );
}
