import type { SlotLayout, StayLayout } from "@/lib/widget-theme";
import { DEFAULT_PAGE } from "../defaults";
import { deepEqual } from "../doc-ops";
import type { PageDocument } from "../schema";

/* The starter's decisions, kept pure so they are testable without React
   (widget templates spec 2026-09-02 §5, §8). StarterDialog renders this;
   it decides nothing on its own. */

/** A page nobody has touched: never published, still the default
    composition, and — the widget templates being org settings — a layout
    still unchosen (the caller says which groups the page asks about). */
export function isFreshPage(page: { draft: PageDocument; published: PageDocument | null }, layoutChosen: boolean): boolean {
  return !layoutChosen && page.published === null && deepEqual(page.draft, DEFAULT_PAGE);
}

export type StarterStep = "layout" | "firstItem" | "done";
/** One pick per group the page shows: times (appointments and hourly
    spaces) and stays. A group the page does not show stays null. */
export type StarterState = { step: StarterStep; layout: SlotLayout | null; stayLayout: StayLayout | null };
export type StarterAction =
  | { kind: "choose"; layout: SlotLayout | null; stayLayout: StayLayout | null; needsFirstItem: boolean }
  | { kind: "created" }
  | { kind: "back" };

/** Appointments start on the layout step; a spaces page with nothing to
    rent yet has no layout to pick and opens straight on its first-space step. */
export function initialStarterState(step: "layout" | "firstItem"): StarterState {
  return { step, layout: null, stayLayout: null };
}

/** layout → (firstItem when the channel has nothing bookable) → done. No
    skip (ruling 2): the only way past firstItem is `created`. Back returns
    to the layout step only when there was one. */
export function starterReducer(state: StarterState, action: StarterAction): StarterState {
  switch (action.kind) {
    case "choose":
      return { layout: action.layout, stayLayout: action.stayLayout, step: action.needsFirstItem ? "firstItem" : "done" };
    case "created":
      return state.step === "firstItem" ? { ...state, step: "done" } : state;
    case "back":
      return state.step === "firstItem" && (state.layout !== null || state.stayLayout !== null) ? { ...state, step: "layout" } : state;
  }
}
