import type { WidgetThemeConfig } from "@/lib/widget-theme";

/** Class list for the hosted booking page's ground in the org's widget
    theme. `.light` / `.dark` re-declare the app tokens; `.book-auto` is
    light under prefers-color-scheme: light and otherwise inherits the app's
    dark tokens (globals.css). Also used by the admin's Booking page preview
    so it composes the page exactly like /book. */
export function bookShellClass(theme: WidgetThemeConfig["theme"]): string {
  const scope = theme === "auto" ? "book-auto" : theme;
  return `${scope} bg-background text-foreground flex flex-1 flex-col`;
}
