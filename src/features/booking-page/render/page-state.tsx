"use client";

import * as React from "react";
import { initialRequest, nextRequest, type PageRequest } from "./page-request";

type PageState = { requested: PageRequest; selectService: (id: string) => void; selectOffering: (id: string) => void };

const Ctx = React.createContext<PageState>({ requested: null, selectService: () => {}, selectOffering: () => {} });

/* Services / Spaces section → booking widget hand-off (see page-request.ts). */
export function PageStateProvider({ initialServiceId, children }: { initialServiceId: string | null; children: React.ReactNode }) {
  const [requested, setRequested] = React.useState<PageRequest>(() => initialRequest(initialServiceId));
  const selectService = React.useCallback((id: string) => setRequested((prev) => nextRequest(prev, "service", id)), []);
  const selectOffering = React.useCallback((id: string) => setRequested((prev) => nextRequest(prev, "offering", id)), []);
  const value = React.useMemo(() => ({ requested, selectService, selectOffering }), [requested, selectService, selectOffering]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePageState(): PageState {
  return React.useContext(Ctx);
}
