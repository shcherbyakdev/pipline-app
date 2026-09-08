import { describe, it, expect } from "vitest";
import { enTranslator } from "@/i18n/test-translator";
import {
  isHourlyOffering,
  durationOptions,
  hourlySlotService,
  blackoutBusy,
  unionUnitSlots,
  formatDurationLabel,
  type HourlyOffering,
} from "./hourly";
import type { PublicOffering } from "@/lib/booking/public";

// A minimal offering satisfying PublicOffering with hours-mode fields set —
// the fields hourly.ts actually reads. Other PublicOffering fields are
// filled with harmless placeholders.
function offering(over: Partial<PublicOffering> = {}): PublicOffering {
  return {
    id: "off-1",
    name: "Tennis court",
    description: null,
    kind: "space",
    rangeMode: "hours",
    startTime: null,
    endTime: null,
    minStay: 1,
    maxStay: null,
    turnoverDays: 0,
    minNoticeDays: 0,
    bookingWindowDays: 30,
    unitSelection: "auto",
    slotIncrementMin: 30,
    minDurationMin: 60,
    maxDurationMin: 240,
    turnoverMin: 15,
    minNoticeMin: 60,
    priceCents: null,
    pricingMode: "per_unit",
    depositType: "none",
    depositValue: null,
    cancelPolicy: [],
    termsText: null,
    requiresApproval: false,
    pricing: null,
    ...over,
  };
}

describe("isHourlyOffering", () => {
  it("true when rangeMode is hours and the duration trio is set", () => {
    expect(isHourlyOffering(offering())).toBe(true);
  });
  it("false when rangeMode is not hours", () => {
    expect(isHourlyOffering(offering({ rangeMode: "nights" }))).toBe(false);
  });
  it("false when the duration trio is missing (nights/days offering shape)", () => {
    expect(
      isHourlyOffering(
        offering({ slotIncrementMin: null, minDurationMin: null, maxDurationMin: null }),
      ),
    ).toBe(false);
  });
});

describe("durationOptions", () => {
  it("60..240 by 30 -> 7 options", () => {
    const o = offering() as HourlyOffering;
    expect(durationOptions(o)).toEqual([60, 90, 120, 150, 180, 210, 240]);
  });
});

describe("hourlySlotService", () => {
  it("maps the offering onto a SlotService for the given duration", () => {
    const o = offering() as HourlyOffering;
    expect(hourlySlotService(o, 90)).toEqual({
      id: "off-1",
      durationMin: 90,
      bufferBeforeMin: 0,
      bufferAfterMin: 15,
      minNoticeMin: 60,
      maxPerDay: null,
      bookingWindowDays: 30,
      stepMin: 30,
      allowTailOverflow: true,
    });
  });
});

describe("blackoutBusy", () => {
  it("spans the whole org-local day range in Warsaw, including a DST day", () => {
    // 2027-03-28 is EU spring-forward (Europe/Warsaw). A blackout covering
    // 2027-03-27..2027-03-28 must occupy both org-local days wholesale,
    // regardless of the DST shift inside them.
    const map = blackoutBusy(
      [{ unitId: "u1", startDate: "2027-03-27", endDate: "2027-03-28" }],
      "Europe/Warsaw",
    );
    const busy = map.get("u1");
    expect(busy).toHaveLength(1);
    // Warsaw is UTC+1 in winter: 2027-03-27T00:00 local = 2027-03-26T23:00Z.
    expect(busy![0].startsAt.toISOString()).toBe("2027-03-26T23:00:00.000Z");
    // End is the day AFTER endDate, at 00:00 local. 2027-03-29 is already
    // past the spring-forward (UTC+2): 2027-03-29T00:00 local = 2027-03-28T22:00Z.
    expect(busy![0].endsAt.toISOString()).toBe("2027-03-28T22:00:00.000Z");
  });

  it("groups multiple blackouts by unit", () => {
    const map = blackoutBusy(
      [
        { unitId: "u1", startDate: "2027-01-01", endDate: "2027-01-02" },
        { unitId: "u1", startDate: "2027-02-01", endDate: "2027-02-01" },
        { unitId: "u2", startDate: "2027-01-01", endDate: "2027-01-01" },
      ],
      "UTC",
    );
    expect(map.get("u1")).toHaveLength(2);
    expect(map.get("u2")).toHaveLength(1);
  });

  it("empty input -> empty map", () => {
    expect(blackoutBusy([], "UTC").size).toBe(0);
  });
});

describe("unionUnitSlots", () => {
  const t = (h: number) => new Date(Date.UTC(2026, 8, 1, h));
  it("two units sharing a start -> one entry with both ids", () => {
    const out = unionUnitSlots([
      { unitId: "a", slots: [t(9), t(10)] },
      { unitId: "b", slots: [t(9)] },
    ]);
    expect(out.map((s) => s.startsAt.getTime())).toEqual([t(9), t(10)].map((d) => d.getTime()));
    expect(out[0].unitIds).toEqual(["a", "b"]);
    expect(out[1].unitIds).toEqual(["a"]);
  });
  it("empty input -> empty", () => expect(unionUnitSlots([])).toEqual([]));
});

describe("formatDurationLabel", () => {
  it("90 -> '1 h 30 min'", () => expect(formatDurationLabel(90, enTranslator("public.units"))).toBe("1 h 30 min"));
  it("60 -> '1 h'", () => expect(formatDurationLabel(60, enTranslator("public.units"))).toBe("1 h"));
  it("45 -> '45 min'", () => expect(formatDurationLabel(45, enTranslator("public.units"))).toBe("45 min"));
});

import { freeUnitsAt } from "./hourly";

describe("freeUnitsAt (S6)", () => {
  const T = (h: number) => new Date(Date.UTC(2026, 8, 10, h));
  const units = [
    { id: "u1", busy: [{ startsAt: T(10), endsAt: T(12) }] },
    { id: "u2", busy: [] },
    { id: "u3", busy: [{ startsAt: T(12), endsAt: T(13) }] },
  ];
  it("counts units with no overlapping busy interval (touching edges are free)", () => {
    expect(freeUnitsAt(units, T(11), T(12))).toBe(2);   // u1 busy
    expect(freeUnitsAt(units, T(12), T(13))).toBe(2);   // u3 busy; u1 ends at 12 → free
    expect(freeUnitsAt(units, T(14), T(15))).toBe(3);
    expect(freeUnitsAt([], T(14), T(15))).toBe(0);
  });
});
