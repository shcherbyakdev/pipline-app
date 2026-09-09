/* One scale for every section, so the sections read as one voice (aave.com
   -referenced, 2026-09-09): Outfit (the display face) at weight 600, tight
   and balanced, for headlines; a secondary-grey Inter lead under it. */
export const H2 = "text-foreground font-display text-[34px] leading-[1.06] font-semibold tracking-[-0.035em] text-balance sm:text-[42px] md:text-[52px]";
export const LEAD = "text-muted-foreground mt-4 text-[17px] leading-relaxed text-balance sm:text-lg";
/* Content width inside a panel or a plain section. */
export const SECTION_INNER = "mx-auto w-full max-w-6xl px-5 sm:px-8";
/* The page is a stack of large rounded panels with the page's gutter
   around them (the reference's device): one wash per panel, the same
   radius everywhere, the same gap between them. Plain sections (no panel)
   take the same vertical air. */
export const PANEL = "mx-3 rounded-[28px] sm:mx-5 sm:rounded-[40px]";
export const PANEL_PAD = "py-16 sm:py-20 md:py-24";
export const SECTION = "pt-16 sm:pt-20 md:pt-24";
