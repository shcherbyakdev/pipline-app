/* The hosted page's type scale and shape rule — one place, every section.
   After gumloop.com: display at weight 500 with -0.025em tracking, body at
   400, everything in the org's own font. Shapes derive from the org's
   corner setting: controls r, cards 2r (the wt-r2 rule in globals.css —
   the widget theme squares every `rounded` to r). */
export const H1 = "text-[32px] leading-[1.08] font-medium tracking-[-0.025em] text-balance sm:text-[40px]";
export const H2 = "text-2xl leading-tight font-medium tracking-[-0.025em] text-balance";
export const LEAD = "text-muted-foreground text-[17px] leading-relaxed text-pretty";
export const R_CARD = "wt-r2";
export const CARD = `${R_CARD} bg-card border`;
/** A card the visitor can pick: lifts on hover, rings when it is the pick. */
export const PICK_CARD = `${CARD} transition-[box-shadow] duration-150 hover:shadow-(--shadow-lift) aria-pressed:ring-2 aria-pressed:ring-[var(--widget-accent)]`;
