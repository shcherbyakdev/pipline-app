import { describe, it, expect } from "vitest";
import { isBookableOffering, toPreviewCatalog } from "./preview-catalog";
import type { OfferingRow } from "@/features/rentals/queries";
import type { PublicService } from "@/lib/booking/public";

const APPTS_ONLY = { offersAppointments: true, offersRentals: false };
const RENTALS_ONLY = { offersAppointments: false, offersRentals: true };
const BOTH = { offersAppointments: true, offersRentals: true };

type ServiceRow = PublicService & { active: boolean };
function service(id: string, active = true): ServiceRow {
  return {
    id, name: id, description: null, durationMin: 30, priceLabel: null,
    bufferBeforeMin: 0, bufferAfterMin: 0, minNoticeMin: 0, maxPerDay: null, bookingWindowDays: 30, active,
    requiresApproval: false,
  };
}
function offering(id: string, active = true, activeUnitCount = 1): OfferingRow {
  return {
    id, name: id, description: null, rangeMode: "nights", startTime: "15:00", endTime: "11:00",
    minStay: 1, maxStay: null, turnoverDays: 0, minNoticeDays: 0, bookingWindowDays: 180,
    unitSelection: "auto", slotIncrementMin: null, minDurationMin: null, maxDurationMin: null,
    turnoverMin: 0, minNoticeMin: 0, active, requiresApproval: false, sortOrder: 0, unitCount: 1, activeUnitCount,
    priceCents: 20000, pricingMode: "per_unit", depositType: "none", depositValue: null,
    cancelWindowMin: 0, termsText: null,
  };
}
const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);

describe("toPreviewCatalog", () => {
  it("appointments-only: real active services, never any offerings", () => {
    const out = toPreviewCatalog({ mode: APPTS_ONLY, services: [service("cut")], offerings: [offering("room")] });
    expect(ids(out.services)).toEqual(["cut"]);
    expect(out.offerings).toEqual([]);
  });

  it("rentals-only: real active offerings and NO services — not even the canned stand-in", () => {
    const out = toPreviewCatalog({
      mode: RENTALS_ONLY,
      services: [service("cut")],
      offerings: [offering("room"), offering("retired", false)],
    });
    expect(out.services).toEqual([]);
    expect(ids(out.offerings)).toEqual(["room"]);
  });

  it("rentals-only with no offering yet: a canned stand-in so appearance can be judged", () => {
    const out = toPreviewCatalog({ mode: RENTALS_ONLY, services: [], offerings: [] });
    expect(out.offerings).toHaveLength(1);
    expect(out.offerings[0].id).toBe("preview-offering");
    expect(out.offerings[0].rangeMode).toBe("nights");
    expect(out.offerings[0].priceCents).toBeGreaterThan(0);
  });

  it("both channels: real services and real offerings side by side", () => {
    const out = toPreviewCatalog({ mode: BOTH, services: [service("cut")], offerings: [offering("room")] });
    expect(ids(out.services)).toEqual(["cut"]);
    expect(ids(out.offerings)).toEqual(["room"]);
  });

  it("both channels with nothing yet: canned service AND canned offering", () => {
    const out = toPreviewCatalog({ mode: BOTH, services: [], offerings: [] });
    expect(ids(out.services)).toEqual(["preview-service"]);
    expect(ids(out.offerings)).toEqual(["preview-offering"]);
  });

  it("a space with no active unit is not listed — the public page won't list it either", () => {
    const out = toPreviewCatalog({ mode: BOTH, services: [service("cut")], offerings: [offering("room"), offering("shell", true, 0)] });
    expect(ids(out.offerings)).toEqual(["room"]);
  });

  it("only unit-less spaces: nothing bookable, so the canned stand-in shows as for an org with no space yet", () => {
    const out = toPreviewCatalog({ mode: RENTALS_ONLY, services: [], offerings: [offering("shell", true, 0)] });
    expect(ids(out.offerings)).toEqual(["preview-offering"]);
  });

  it("isBookableOffering: active with an active unit — the one rule the pages use to decide what a preview shows", () => {
    expect(isBookableOffering(offering("room"))).toBe(true);
    expect(isBookableOffering(offering("shell", true, 0))).toBe(false);
    expect(isBookableOffering(offering("retired", false))).toBe(false);
  });

  it("the projection keeps the public shape only — no admin-only fields leak into the preview", () => {
    const out = toPreviewCatalog({ mode: BOTH, services: [], offerings: [offering("room")] });
    expect(out.offerings[0]).not.toHaveProperty("unitCount");
    expect(out.offerings[0]).not.toHaveProperty("active");
    expect(out.offerings[0]).not.toHaveProperty("sortOrder");
  });
});
