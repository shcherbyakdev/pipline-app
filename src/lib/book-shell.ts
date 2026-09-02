import type { WidgetThemeConfig } from "@/lib/widget-theme";

/** Class list for the hosted booking page's ground in the org's widget
    theme. `.light` / `.dark` re-declare the app tokens; `.book-auto`
    inherits the light root and takes the dark set only while the visitor's
    system is dark (globals.css). Also used by the admin's Booking page
    preview so it composes the page exactly like /book. */
export function bookShellClass(theme: WidgetThemeConfig["theme"]): string {
  const scope = theme === "auto" ? "book-auto" : theme;
  // `book-page`: the hosted page's neutral palette (globals.css).
  return `book-page ${scope} bg-background text-foreground flex flex-1 flex-col`;
}
