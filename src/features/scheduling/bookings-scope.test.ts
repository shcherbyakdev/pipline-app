import { describe, it, expect } from "vitest";
import { parseScope, scopeQuery, scopeLabel, scopeItems, applyScope, scopeHoursOwners, scopedSpace } from "./bookings-scope";
import type { AdminBooking } from "@/features/scheduling/queries";

const anna = { id: "11111111-1111-4111-8111-111111111111", name: "Anna", color: "#c00" };
const ben = { id: "22222222-2222-4222-8222-222222222222", name: "Ben", color: "#0c0" };
const studio = { id: "33333333-3333-4333-8333-333333333333", name: "Studio A", rangeMode: "hours" as const };
const flat = { id: "44444444-4444-4444-8444-444444444444", name: "Flat 1", rangeMode: "nights" as const };

const people = [anna, ben];
const spaces = [studio, flat];

describe("parseScope (one `?show=` param; stale or foreign ids fall back to everything)", () => {
  it("no param ⇒ all bookings", () => {
    expect(parseScope({}, people, spaces)).toEqual({ kind: "all" });
  });
  it("show=appointments ⇒ every person's appointments", () => {
    expect(parseScope({ show: "appointments" }, people, spaces)).toEqual({ kind: "appointments", staffIds: null });
  });
  it("show=staff:<id> ⇒ that person", () => {
    expect(parseScope({ show: `staff:${anna.id}` }, people, spaces)).toEqual({ kind: "appointments", staffIds: [anna.id] });
  });
  it("show=spaces ⇒ every space booking", () => {
    expect(parseScope({ show: "spaces" }, people, spaces)).toEqual({ kind: "spaces", offeringId: null });
  });
  it("show=space:<id> ⇒ that space", () => {
    expect(parseScope({ show: `space:${flat.id}` }, people, spaces)).toEqual({ kind: "spaces", offeringId: flat.id });
  });
  it("an id that names nobody listed ⇒ all", () => {
    expect(parseScope({ show: "staff:99999999-9999-4999-8999-999999999999" }, people, spaces)).toEqual({ kind: "all" });
    expect(parseScope({ show: `space:${anna.id}` }, people, spaces)).toEqual({ kind: "all" });
    expect(parseScope({ show: "staff:junk" }, people, spaces)).toEqual({ kind: "all" });
  });
  it("a kind the org does not sell ⇒ all", () => {
    expect(parseScope({ show: "appointments" }, [], spaces)).toEqual({ kind: "all" });
    expect(parseScope({ show: "spaces" }, people, [])).toEqual({ kind: "all" });
  });
  it("legacy ?staff=a,b (the old chip row) still narrows to those people", () => {
    expect(parseScope({ staff: `${anna.id},${ben.id}` }, [anna, ben, { ...anna, id: "55555555-5555-4555-8555-555555555555", name: "Cy" }], spaces))
      .toEqual({ kind: "appointments", staffIds: [anna.id, ben.id] });
  });
  it("legacy ?staff= naming everyone (or nobody real) ⇒ all", () => {
    expect(parseScope({ staff: `${anna.id},${ben.id}` }, people, spaces)).toEqual({ kind: "all" });
    expect(parseScope({ staff: "junk" }, people, spaces)).toEqual({ kind: "all" });
  });
  it("show= wins over a legacy staff= on the same URL", () => {
    expect(parseScope({ show: "spaces", staff: anna.id }, people, spaces)).toEqual({ kind: "spaces", offeringId: null });
  });
});

describe("scopeQuery (what the week arrows, Today and the switcher carry)", () => {
  it("all ⇒ nothing to carry", () => {
    expect(scopeQuery({ kind: "all" })).toBe("");
  });
  it("round-trips every scope through parseScope", () => {
    const scopes = [
      { kind: "appointments" as const, staffIds: null },
      { kind: "appointments" as const, staffIds: [anna.id] },
      { kind: "spaces" as const, offeringId: null },
      { kind: "spaces" as const, offeringId: studio.id },
    ];
    for (const scope of scopes) {
      const qs = scopeQuery(scope);
      expect(qs.startsWith("show=")).toBe(true);
      expect(parseScope({ show: qs.slice("show=".length) }, people, spaces)).toEqual(scope);
    }
  });
  it("a legacy multi-person scope keeps its people", () => {
    const qs = scopeQuery({ kind: "appointments", staffIds: [anna.id, ben.id] });
    expect(parseScope({ show: qs.slice("show=".length) }, [anna, ben, { ...anna, id: "55555555-5555-4555-8555-555555555555" }], spaces))
      .toEqual({ kind: "appointments", staffIds: [anna.id, ben.id] });
  });
});

describe("scopeLabel (what the trigger reads)", () => {
  it("names the lens", () => {
    expect(scopeLabel({ kind: "all" }, people, spaces)).toBe("All bookings");
    expect(scopeLabel({ kind: "appointments", staffIds: null }, people, spaces)).toBe("Appointments");
    expect(scopeLabel({ kind: "appointments", staffIds: [ben.id] }, people, spaces)).toBe("Ben");
    expect(scopeLabel({ kind: "appointments", staffIds: [anna.id, ben.id] }, people, spaces)).toBe("2 people");
    expect(scopeLabel({ kind: "spaces", offeringId: null }, people, spaces)).toBe("Spaces");
    expect(scopeLabel({ kind: "spaces", offeringId: studio.id }, people, spaces)).toBe("Studio A");
  });
});

const labels = (groups: NonNullable<ReturnType<typeof scopeItems>>) =>
  groups.map((g) => [g.label, g.items.map((i) => i.label)]);

describe("scopeItems (the menu follows the org's shape; fewer than two real choices ⇒ no control)", () => {
  it("solo person, no spaces ⇒ nothing to choose", () => {
    expect(scopeItems([anna], [])).toBeNull();
  });
  it("one space, no appointments ⇒ nothing to choose", () => {
    expect(scopeItems([], [studio])).toBeNull();
  });
  it("a team without spaces ⇒ the chip row as a flat list", () => {
    expect(labels(scopeItems(people, [])!)).toEqual([[null, ["All bookings", "Anna", "Ben"]]]);
  });
  it("spaces only ⇒ a flat list of spaces", () => {
    expect(labels(scopeItems([], spaces)!)).toEqual([[null, ["All bookings", "Studio A", "Flat 1"]]]);
  });
  it("both channels ⇒ grouped, with an every-X entry only for a group of two or more", () => {
    expect(labels(scopeItems(people, spaces)!)).toEqual([
      [null, ["All bookings"]],
      ["Appointments", ["All appointments", "Anna", "Ben"]],
      ["Spaces", ["All spaces", "Studio A", "Flat 1"]],
    ]);
    // a solo person is the kind, not a name (U3: the sole person stays nameless)
    expect(labels(scopeItems([anna], spaces)!)).toEqual([
      [null, ["All bookings"]],
      ["Appointments", ["Appointments"]],
      ["Spaces", ["All spaces", "Studio A", "Flat 1"]],
    ]);
    // a sole space keeps its name under the heading
    expect(labels(scopeItems([anna], [studio])!)).toEqual([
      [null, ["All bookings"]],
      ["Appointments", ["Appointments"]],
      ["Spaces", ["Studio A"]],
    ]);
  });
  it("every item's value parses back to its scope, and carries the person's colour / the space mark", () => {
    const groups = scopeItems(people, spaces)!;
    for (const g of groups) {
      for (const item of g.items) {
        expect(parseScope({ show: item.value }, people, spaces)).toEqual(item.scope);
      }
    }
    const annaItem = groups[1].items.find((i) => i.label === "Anna")!;
    expect(annaItem.color).toBe("#c00");
    expect(annaItem.space).toBeUndefined();
    const studioItem = groups[2].items.find((i) => i.label === "Studio A")!;
    expect(studioItem.space).toBe(true);
    expect(groups[0].items[0].value).toBe("all");
  });
});

const base = {
  serviceId: null, rentalOfferingId: null, rentalUnitId: null, rangeMode: null, serviceName: "x",
  clientName: "c", clientEmail: null, startsAt: "2026-08-25T09:00:00Z", endsAt: "2026-08-25T10:00:00Z",
  status: "confirmed", note: null, rescheduledFromId: null, staffId: null, staffName: null, staffColor: null,
} as unknown as AdminBooking;
const appt = (id: string, staffId: string): AdminBooking => ({ ...base, id, serviceId: "svc", staffId });
const stay = (id: string, offeringId: string): AdminBooking =>
  ({ ...base, id, rentalOfferingId: offeringId, rentalUnitId: "unit", rangeMode: "hours" });
const rows = [appt("a1", anna.id), appt("b1", ben.id), stay("s1", studio.id), stay("f1", flat.id)];
const ids = (bs: AdminBooking[]) => bs.map((b) => b.id);

describe("applyScope (one org-week of rows, narrowed in memory)", () => {
  it("all ⇒ everything, untouched", () => {
    expect(applyScope(rows, { kind: "all" })).toBe(rows);
  });
  it("appointments ⇒ no space bookings; one person ⇒ only theirs", () => {
    expect(ids(applyScope(rows, { kind: "appointments", staffIds: null }))).toEqual(["a1", "b1"]);
    expect(ids(applyScope(rows, { kind: "appointments", staffIds: [ben.id] }))).toEqual(["b1"]);
  });
  it("spaces ⇒ only space bookings; one space ⇒ only its bookings", () => {
    expect(ids(applyScope(rows, { kind: "spaces", offeringId: null }))).toEqual(["s1", "f1"]);
    expect(ids(applyScope(rows, { kind: "spaces", offeringId: flat.id }))).toEqual(["f1"]);
  });
});

describe("scopeHoursOwners (whose hours hatch the week)", () => {
  const staff = [anna, ben];
  it("all and every-person scopes ⇒ every active member, as today", () => {
    expect(scopeHoursOwners({ kind: "all" }, staff, spaces)).toEqual([{ staffId: anna.id }, { staffId: ben.id }]);
    expect(scopeHoursOwners({ kind: "appointments", staffIds: null }, staff, spaces)).toEqual([{ staffId: anna.id }, { staffId: ben.id }]);
  });
  it("some people ⇒ just them", () => {
    expect(scopeHoursOwners({ kind: "appointments", staffIds: [ben.id] }, staff, spaces)).toEqual([{ staffId: ben.id }]);
  });
  it("spaces ⇒ the hourly ones; one hourly space ⇒ it alone", () => {
    expect(scopeHoursOwners({ kind: "spaces", offeringId: null }, staff, spaces)).toEqual([{ rentalOfferingId: studio.id }]);
    expect(scopeHoursOwners({ kind: "spaces", offeringId: studio.id }, staff, spaces)).toEqual([{ rentalOfferingId: studio.id }]);
  });
  it("a nights/days-only scope has no clock hours ⇒ the members' hours, as a rentals-only week draws today", () => {
    expect(scopeHoursOwners({ kind: "spaces", offeringId: flat.id }, staff, spaces)).toEqual([{ staffId: anna.id }, { staffId: ben.id }]);
    expect(scopeHoursOwners({ kind: "spaces", offeringId: null }, staff, [flat])).toEqual([{ staffId: anna.id }, { staffId: ben.id }]);
  });
});

describe("scopedSpace (what New booking starts on under a space scope)", () => {
  it("one space ⇒ that space; every space ⇒ the first hourly one, else the first", () => {
    expect(scopedSpace({ kind: "spaces", offeringId: flat.id }, spaces)?.id).toBe(flat.id);
    expect(scopedSpace({ kind: "spaces", offeringId: null }, [flat, studio])?.id).toBe(studio.id);
    expect(scopedSpace({ kind: "spaces", offeringId: null }, [flat])?.id).toBe(flat.id);
  });
  it("any other scope ⇒ none (the dialog's own defaults apply)", () => {
    expect(scopedSpace({ kind: "all" }, spaces)).toBeNull();
    expect(scopedSpace({ kind: "appointments", staffIds: null }, spaces)).toBeNull();
  });
});
