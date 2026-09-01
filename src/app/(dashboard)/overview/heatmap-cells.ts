/* Shared by the server page (legend) and the client YearGrid — a "use
   client" module's exports turn into client references on the server, so
   plain values must live outside it. */

export const HEAT_LEVELS = [
  "bg-muted",
  "bg-primary/25",
  "bg-primary/45",
  "bg-primary/70",
  "bg-primary",
] as const;

/* Amber = "needs attention", matching the rentals timeline. A pending-only
   day fills solid amber; a day that also has confirmed appointments keeps its
   load fill and gets the amber ring instead (the fill must stay readable).
   Today reuses the brand outline so it can stack with either. */
export const PENDING_FILL = "bg-amber-400 dark:bg-amber-500";
export const PENDING_RING = "ring-2 ring-amber-500 ring-inset";
export const TODAY_OUTLINE = "outline-2 outline-brand-text";

export const CELL = "size-[13px] rounded-[3px]";
