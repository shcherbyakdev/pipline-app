export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  // Bare passthrough — no wrapper element, no padding, no background here.
  // The root layout hardcodes dark mode, so anything painted at this level
  // shows through as a dark frame around a light widget. Sizing/padding and
  // the actual background live inside WidgetTheme (see [handle]/page.tsx)
  // so --widget-bg covers the full iframe viewport instead.
  return children;
}
