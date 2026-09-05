import type { WidgetThemeConfig } from "@/lib/widget-theme";

/** Class list for the hosted booking page's ground in the org's widget
    theme. `.light` / `.dark` re-declare the app tokens; `.book-auto`
    inherits the light root and takes the dark set only while the visitor's
    system is dark (globals.css). The ground is the admin shell's own
    (`--sidebar`, the soft lavender / near-black): the page itself is the
    floating panel PageRenderer draws on it, as in the admin and the
    landing's hero card. Also used by the admin's Booking page preview so it
    composes the page exactly like /<handle>. */
export function bookShellClass(theme: WidgetThemeConfig["theme"]): string {
  const scope = theme === "auto" ? "book-auto" : theme;
  return `${scope} bg-sidebar text-foreground flex flex-1 flex-col`;
}

/** The page column on that ground: the live page, a person's page and the
    studio preview share it. Width comes from pageContainerClass. */
export const BOOK_COLUMN_CLASS = "mx-auto flex w-full flex-col gap-5 px-3 pt-4 pb-8 sm:px-6 sm:pt-10";
