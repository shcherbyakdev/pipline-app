"use client";

import * as React from "react";
import { createPortal } from "react-dom";

export const PAGE_ACTIONS_ID = "page-actions";

// Never changes once the shell is up, so the store never notifies; the
// subscription exists only so React reads the node on the client and not
// during hydration (null there, like the server).
const subscribe = () => () => {};
const getSlot = () => document.getElementById(PAGE_ACTIONS_ID);
const noSlot = () => null;

/* A page's own actions, rendered on the right of the top bar (the slot
   TopBar leaves there) instead of in a row of their own. A portal, because
   the bar lives in the layout and the actions need the page's data — they
   appear on hydration, so keep this for buttons, never for content. */
export function PageActions({ children }: { children: React.ReactNode }) {
  const slot = React.useSyncExternalStore(subscribe, getSlot, noSlot);
  return slot ? createPortal(children, slot) : null;
}
