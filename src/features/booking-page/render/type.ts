/* The hosted page's type scale and shape rule — one place, every section.
   Display at weight 500 with -0.025em tracking, body at 400, everything in
   the org's own font (DESIGN.md Typography). Shapes derive from the org's
   corner setting: controls r, cards 2r (the wt-r2 rule in globals.css —
   the widget theme squares every `rounded` to r). */
export const H1 = "text-[32px] leading-[1.08] font-medium tracking-[-0.025em] text-balance sm:text-[40px]";
export const H2 = "text-2xl leading-tight font-medium tracking-[-0.025em] text-balance";
export const LEAD = "text-muted-foreground text-[17px] leading-relaxed text-pretty";
export const R_CARD = "wt-r2";
/** A white card on the hairline: the product's list row. */
export const CARD = `${R_CARD} bg-card border`;
/** A card the visitor can pick: lifts on hover, rings when it is the pick. */
export const PICK_CARD = `${CARD} transition-[box-shadow,border-color] duration-150 ease-strong hover:shadow-(--shadow-lift) aria-pressed:ring-2 aria-pressed:ring-[var(--widget-accent)]`;

/* The widget's own vocabulary (shared by the appointment widget and the
   space flows, so every template reads the same). Minimal by ruling
   (2026-09-06): nothing sits in a box — grids and receipts lie on the
   ground, lists are hairline-divided rows, structure is whitespace. */
/** A free time, a duration, a stay length: a white chip on the hairline
    that lifts on hover; `wt-primary` replaces it once picked. */
export const CHIP = "wt-chip border transition-[box-shadow,background-color] duration-150 ease-strong";
/** A pickable row (a service, a space, a unit, a free stay) in a hairline
    list (`ROW_LIST` on the <ul>): the tint on hover reaches 12px past the
    text on either side, the divider stays on the text's own edges. */
export const ROW_LIST = "flex flex-col divide-y";
export const ROW = "wt-surface -mx-3 flex w-[calc(100%+1.5rem)] items-center justify-between gap-4 rounded-md px-3 py-3.5 text-left text-sm transition-[background-color] duration-150 ease-strong aria-pressed:bg-[color-mix(in_oklab,var(--widget-tint,var(--widget-accent))_10%,transparent)]";
/** A receipt (what is being booked) or a money block: lines on the ground,
    a hairline under them. */
export const RECEIPT = "flex items-start justify-between gap-4 border-b pb-4 text-sm";
/** The step heading over a picker ("Consultation", "Mon 07 Sept"). */
export const STEP_LABEL = "text-sm font-medium";
/** The quiet way back a step: "change". */
export const CHANGE_LINK = "text-muted-foreground hover:text-foreground text-sm underline-offset-3 hover:underline transition-colors duration-150";
