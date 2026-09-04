"use client";

import * as React from "react";
import { initialRequest, nextRequest, nextStaffRequest, type PageRequest, type StaffRequest } from "./page-request";

type PageState = {
  requested: PageRequest;
  /** The Team section's pick; the widget narrows to it (staff.tsx). */
  staffPick: StaffRequest;
  selectService: (id: string) => void;
  selectOffering: (id: string) => void;
  selectStaff: (id: string) => void;
};

const Ctx = React.createContext<PageState>({ requested: null, staffPick: null, selectService: () => {}, selectOffering: () => {}, selectStaff: () => {} });

/* Services / Spaces section → booking widget hand-off (see page-request.ts).
   `initialServiceId` / `initialOfferingId` are the `?service=` / `?space=`
   deep links, already resolved against the catalogue by the page. */
export function PageStateProvider({
  initialServiceId,
  initialOfferingId = null,
  children,
}: {
  initialServiceId: string | null;
  initialOfferingId?: string | null;
  children: React.ReactNode;
}) {
  const [requested, setRequested] = React.useState<PageRequest>(() => initialRequest(initialServiceId, initialOfferingId));
  const selectService = React.useCallback((id: string) => setRequested((prev) => nextRequest(prev, "service", id)), []);
  const selectOffering = React.useCallback((id: string) => setRequested((prev) => nextRequest(prev, "offering", id)), []);
  const [staffPick, setStaffPick] = React.useState<StaffRequest>(null);
  const selectStaff = React.useCallback((id: string) => setStaffPick((prev) => nextStaffRequest(prev, id)), []);
  const value = React.useMemo(
    () => ({ requested, staffPick, selectService, selectOffering, selectStaff }),
    [requested, staffPick, selectService, selectOffering, selectStaff],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePageState(): PageState {
  return React.useContext(Ctx);
}
