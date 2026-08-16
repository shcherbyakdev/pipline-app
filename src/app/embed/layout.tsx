export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  // No wrapper element, no padding here — sizing/padding and the actual
  // widget background live inside WidgetTheme (see [handle]/page.tsx) so
  // --widget-bg covers exactly the content, not the full iframe viewport.
  //
  // The scoped <style> below makes html/body transparent for /embed routes
  // only. The root layout hardcodes dark mode on <html>, and WidgetTheme no
  // longer has min-h-dvh (see [handle]/page.tsx for why), so there's a brief
  // window before embed.js's first resize message where the iframe is taller
  // than WidgetTheme's content — without this, that gap would paint as a
  // dark frame instead of letting the host page's own background show
  // through, which is the standard behavior for embedded widgets.
  return (
    <>
      <style>{"html, body { background: transparent }"}</style>
      {children}
    </>
  );
}
