import type { WidgetThemeConfig } from "@/lib/widget-theme";

/** Class list for the hosted booking page's ground in the org's widget
    theme. `.light` / `.dark` re-declare the app tokens; `.book-auto`
    inherits the light root and takes the dark set only while the visitor's
    system is dark (globals.css). The page sits straight on the app's ground
    (2026-09-06, Andrii: "more minimalistic, I don't like the wrappers"):
    no panel, no card around it — whitespace and hairlines carry the
    structure. Also used by the admin's Booking page preview so it composes
    the page exactly like /<handle>. */
export function bookShellClass(theme: WidgetThemeConfig["theme"]): string {
  const scope = theme === "auto" ? "book-auto" : theme;
  return `${scope} bg-background text-foreground flex flex-1 flex-col`;
}

/** The page column on that ground: the live page, a person's page and the
    studio preview share it. Width comes from pageContainerClass. */
export const BOOK_COLUMN_CLASS = "mx-auto flex w-full flex-col gap-8 px-5 pt-10 pb-10 sm:px-6 sm:pt-14";
