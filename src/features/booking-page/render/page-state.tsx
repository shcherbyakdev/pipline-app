"use client";

import * as React from "react";

type Request = { id: string; key: number } | null;
type PageState = { requested: Request; selectService: (id: string) => void };

const Ctx = React.createContext<PageState>({ requested: null, selectService: () => {} });

/* Services section → booking widget hand-off. The key makes every request
   distinct, so picking the same service twice (after "change") still lands. */
export function PageStateProvider({ initialServiceId, children }: { initialServiceId: string | null; children: React.ReactNode }) {
  const [requested, setRequested] = React.useState<Request>(initialServiceId ? { id: initialServiceId, key: 1 } : null);
  const selectService = React.useCallback((id: string) => setRequested((prev) => ({ id, key: (prev?.key ?? 0) + 1 })), []);
  const value = React.useMemo(() => ({ requested, selectService }), [requested, selectService]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePageState(): PageState {
  return React.useContext(Ctx);
}
