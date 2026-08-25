import { describe, it, expect } from "vitest";
import { applyStaffLens } from "./staff-lens";
import type { AdminBooking } from "@/features/scheduling/queries";

const base = {
  serviceId: null, rentalOfferingId: null, rentalUnitId: null, rangeMode: null, serviceName: "x",
  clientName: "c", clientEmail: null, startsAt: "2026-08-25T09:00:00Z", endsAt: "2026-08-25T10:00:00Z",
  status: "confirmed", note: null, rescheduledFromId: null, staffId: null, staffName: null, staffColor: null,
} as unknown as AdminBooking;
const appt = (id: string, staffId: string): AdminBooking => ({ ...base, id, serviceId: "svc", staffId });
const space = (id: string): AdminBooking => ({ ...base, id, rentalOfferingId: "off", rentalUnitId: "unit", rangeMode: "hours" });

describe("applyStaffLens (spec §2 — a person's lens hides spaces but says so)", () => {
  const rows = [appt("a1", "anna"), appt("b1", "ben"), space("s1"), space("s2")];
  it("no lens: everything visible, nothing hidden", () => {
    expect(applyStaffLens(rows, undefined)).toEqual({ visible: rows, hiddenSpaces: 0 });
  });
  it("a lens keeps only that person's appointments and counts the dropped spaces", () => {
    const r = applyStaffLens(rows, ["anna"]);
    expect(r.visible.map((b) => b.id)).toEqual(["a1"]);
    expect(r.hiddenSpaces).toBe(2);
  });
  it("a lens on a week without spaces hides nothing to report", () => {
    expect(applyStaffLens([appt("a1", "anna"), appt("b1", "ben")], ["ben"]).hiddenSpaces).toBe(0);
  });
});
