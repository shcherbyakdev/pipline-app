"use client";

import * as React from "react";

export type Selection = { selectedId: string | null; select: (id: string) => void };
const Ctx = React.createContext<Selection>({ selectedId: null, select: () => {} });

/* Studio only: which section the preview highlights and the inspector edits.
   Absent (public page, template thumbnails) the default no-op context applies. */
export function SelectionProvider({ value, children }: { value: Selection; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSelection(): Selection {
  return React.useContext(Ctx);
}
