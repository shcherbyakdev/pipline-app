import { DEFAULT_PAGE } from "../defaults";
import { deepEqual } from "../doc-ops";
import type { PageDocument } from "../schema";
import type { BusinessType } from "../business-types";

/* The starter's decisions, kept pure so they are testable without React
   (spec 2026-08-28 §5.1, §5.3). StarterDialog renders this; it decides
   nothing on its own. */

/** A page nobody has touched: never published, still the default composition. */
export function isFreshPage(page: { draft: PageDocument; published: PageDocument | null }): boolean {
  return page.published === null && deepEqual(page.draft, DEFAULT_PAGE);
}

/** "Also apply this look" default: on only while the org-wide look is
    unclaimed — no page of the org is published on any channel. Applying
    the skin saves to the live widget theme, which the other page and the
    embed share. */
export function skinDefault(anyPublished: boolean): boolean {
  return !anyPublished;
}

export type StarterStep = "type" | "firstItem" | "done";
export type StarterState = { step: StarterStep; type: BusinessType | null; applyLook: boolean };
export type StarterAction =
  | { kind: "choose"; type: BusinessType; needsFirstItem: boolean }
  | { kind: "created" }
  | { kind: "back" }
  | { kind: "toggleLook"; value: boolean };

export function initialStarterState(opts: { applyLook: boolean }): StarterState {
  return { step: "type", type: null, applyLook: opts.applyLook };
}

/** type → (firstItem when the channel has nothing bookable) → done. No
    skip (ruling 2): the only way past firstItem is `created`. */
export function starterReducer(state: StarterState, action: StarterAction): StarterState {
  switch (action.kind) {
    case "choose":
      return { ...state, type: action.type, step: action.needsFirstItem ? "firstItem" : "done" };
    case "created":
      return state.step === "firstItem" ? { ...state, step: "done" } : state;
    case "back":
      return state.step === "firstItem" ? { ...state, step: "type" } : state;
    case "toggleLook":
      return { ...state, applyLook: action.value };
  }
}
