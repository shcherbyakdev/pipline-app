import { describe, it, expect } from "vitest";
import {
  parseScope,
  scopeQuery,
  scopeLabel,
  scopeItems,
  scopeItemChecked,
  toggleScopeItem,
  scopeSides,
  applyScope,
  scopeHoursOwners,
  scopedSpace,
  type Scope,
  type ScopeText,
} from "./bookings-scope";
import type { AdminBooking } from "@/features/scheduling/queries";

// The module hands the UI names, message keys and counts (i18n Wave 3);
// the tests read them the way the trigger would in English.
const text = (x: ScopeText) => ("name" in x ? x.name : "count" in x ? `${x.count} selected` : x.key);

const anna = { id: "11111111-1111-4111-8111-111111111111", name: "Anna", color: "#c00" };
const ben = { id: "22222222-2222-4222-8222-222222222222", name: "Ben", color: "#0c0" };
const cy = { id: "55555555-5555-4555-8555-555555555555", name: "Cy", color: "#00c" };
const studio = { id: "33333333-3333-4333-8333-333333333333", name: "Studio A", rangeMode: "hours" as const };
const flat = { id: "44444444-4444-4444-8444-444444444444", name: "Flat 1", rangeMode: "nights" as const };

const people = [anna, ben];
const spaces = [studio, flat];
const ALL: Scope = { kind: "all" };
const some = (p: "all" | string[], s: "all" | string[]): Scope => ({ kind: "some", people: p, spaces: s });

describe("parseScope (one `?show=` param of tokens; stale or foreign ids fall back to everything)", () => {
  it("no param ⇒ all bookings", () => {
    expect(parseScope({}, people, spaces)).toEqual(ALL);
  });
  it("appointments ⇒ every person, no spaces", () => {
    expect(parseScope({ show: "appointments" }, people, spaces)).toEqual(some("all", []));
  });
  it("staff:<id> ⇒ that person alone", () => {
    expect(parseScope({ show: `staff:${anna.id}` }, people, spaces)).toEqual(some([anna.id], []));
  });
  it("spaces ⇒ every space, no people", () => {
    expect(parseScope({ show: "spaces" }, people, spaces)).toEqual(some([], "all"));
  });
  it("space:<id> ⇒ that space alone", () => {
    expect(parseScope({ show: `space:${flat.id}` }, people, spaces)).toEqual(some([], [flat.id]));
  });
  it("a mix ⇒ a person and a space together", () => {
    expect(parseScope({ show: `staff:${ben.id},space:${studio.id}` }, people, spaces)).toEqual(
      some([ben.id], [studio.id]),
    );
  });
  it("every member named one by one is the group; every group is everything", () => {
    expect(parseScope({ show: `staff:${anna.id},staff:${ben.id}` }, people, spaces)).toEqual(some("all", []));
    expect(parseScope({ show: `staff:${anna.id},staff:${ben.id},spaces` }, people, spaces)).toEqual(ALL);
    expect(parseScope({ show: "appointments,spaces" }, people, spaces)).toEqual(ALL);
  });
  it("ids that name nobody listed drop out; nothing left ⇒ all", () => {
    expect(parseScope({ show: "staff:99999999-9999-4999-8999-999999999999" }, people, spaces)).toEqual(ALL);
    expect(parseScope({ show: `space:${anna.id}` }, people, spaces)).toEqual(ALL);
    expect(parseScope({ show: "staff:junk,,what" }, people, spaces)).toEqual(ALL);
    expect(parseScope({ show: `staff:junk,space:${flat.id}` }, people, spaces)).toEqual(some([], [flat.id]));
  });
  it("a kind the org does not sell is vacuous ⇒ all", () => {
    expect(parseScope({ show: "appointments" }, [], spaces)).toEqual(ALL);
    expect(parseScope({ show: "spaces" }, people, [])).toEqual(ALL);
  });
  it("a person on an org without spaces is just that person", () => {
    expect(parseScope({ show: `staff:${anna.id}` }, people, [])).toEqual(some([anna.id], "all"));
  });
  it("legacy ?staff=a,b (the old chip row) still narrows to those people", () => {
    expect(parseScope({ staff: `${anna.id},${ben.id}` }, [anna, ben, cy], spaces)).toEqual(some([anna.id, ben.id], []));
    expect(parseScope({ staff: `${anna.id},${ben.id}` }, people, spaces)).toEqual(some("all", []));
    expect(parseScope({ staff: "junk" }, people, spaces)).toEqual(ALL);
  });
  it("show= wins over a legacy staff= on the same URL", () => {
    expect(parseScope({ show: "spaces", staff: anna.id }, people, spaces)).toEqual(some([], "all"));
  });
});

describe("scopeQuery (what the week arrows, Today and the switcher carry)", () => {
  it("all ⇒ nothing to carry", () => {
    expect(scopeQuery(ALL, people, spaces)).toBe("");
  });
  it("round-trips every scope through parseScope", () => {
    const scopes = [
      some("all", []),
      some([anna.id], []),
      some([], "all"),
      some([], [studio.id]),
      some([ben.id], [studio.id]),
      some("all", [flat.id]),
      some([anna.id], "all"),
    ];
    for (const scope of scopes) {
      const qs = scopeQuery(scope, people, spaces);
      expect(qs.startsWith("show=")).toBe(true);
      expect(parseScope({ show: qs.slice("show=".length) }, people, spaces)).toEqual(scope);
    }
  });
  it("a vacuous side (a kind the org does not sell) leaves no token behind", () => {
    expect(scopeQuery(some([anna.id], "all"), people, [])).toBe(`show=staff:${anna.id}`);
    expect(scopeQuery(some("all", [studio.id]), [], spaces)).toBe(`show=space:${studio.id}`);
  });
});

describe("scopeLabel (what the trigger reads)", () => {
  it("names one thing, counts several", () => {
    expect(text(scopeLabel(ALL, people, spaces))).toBe("bookings.scope.all");
    expect(text(scopeLabel(some("all", []), people, spaces))).toBe("appointments.scope.group");
    expect(text(scopeLabel(some([ben.id], []), people, spaces))).toBe("Ben");
    expect(text(scopeLabel(some([], "all"), people, spaces))).toBe("spaces.scope.group");
    expect(text(scopeLabel(some([], [studio.id]), people, spaces))).toBe("Studio A");
    expect(text(scopeLabel(some([anna.id, ben.id], []), [anna, ben, cy], spaces))).toBe("2 selected");
    expect(text(scopeLabel(some([anna.id], [studio.id]), people, spaces))).toBe("2 selected");
    expect(text(scopeLabel(some("all", [studio.id]), people, spaces))).toBe("2 selected");
  });
  it("ignores a vacuous side", () => {
    expect(text(scopeLabel(some([anna.id], "all"), people, []))).toBe("Anna");
  });
});

const labels = (groups: NonNullable<ReturnType<typeof scopeItems>>) =>
  groups.map((g) => [g.label ? text(g.label) : null, g.items.map((i) => text(i.label))]);

describe("scopeItems (the menu follows the org's shape; fewer than two real choices ⇒ no control)", () => {
  it("solo person, no spaces ⇒ nothing to choose", () => {
    expect(scopeItems([anna], [])).toBeNull();
  });
  it("one space, no appointments ⇒ nothing to choose", () => {
    expect(scopeItems([], [studio])).toBeNull();
  });
  it("a team without spaces ⇒ the chip row as a flat list", () => {
    expect(labels(scopeItems(people, [])!)).toEqual([[null, ["bookings.scope.all", "Anna", "Ben"]]]);
  });
  it("spaces only ⇒ a flat list of spaces", () => {
    expect(labels(scopeItems([], spaces)!)).toEqual([[null, ["bookings.scope.all", "Studio A", "Flat 1"]]]);
  });
  it("both channels ⇒ grouped, with an every-X entry only for a group of two or more", () => {
    expect(labels(scopeItems(people, spaces)!)).toEqual([
      [null, ["bookings.scope.all"]],
      ["appointments.scope.group", ["appointments.scope.all", "Anna", "Ben"]],
      ["spaces.scope.group", ["spaces.scope.all", "Studio A", "Flat 1"]],
    ]);
    // a solo person is the kind, not a name (U3: the sole person stays nameless)
    expect(labels(scopeItems([anna], spaces)!)).toEqual([
      [null, ["bookings.scope.all"]],
      ["appointments.scope.group", ["appointments.scope.group"]],
      ["spaces.scope.group", ["spaces.scope.all", "Studio A", "Flat 1"]],
    ]);
    // a sole space keeps its name under the heading
    expect(labels(scopeItems([anna], [studio])!)).toEqual([
      [null, ["bookings.scope.all"]],
      ["appointments.scope.group", ["appointments.scope.group"]],
      ["spaces.scope.group", ["Studio A"]],
    ]);
  });
  it("items carry the person's colour / the space mark", () => {
    const groups = scopeItems(people, spaces)!;
    const annaItem = groups[1].items.find((i) => text(i.label) === "Anna")!;
    expect(annaItem.color).toBe("#c00");
    expect(annaItem.space).toBeUndefined();
    const studioItem = groups[2].items.find((i) => text(i.label) === "Studio A")!;
    expect(studioItem.space).toBe(true);
    expect(groups[0].items[0].kind).toBe("all");
  });
});

describe("scopeItemChecked + toggleScopeItem (ticking the menu)", () => {
  const groups = scopeItems(people, spaces)!;
  const item = (label: string) => groups.flatMap((g) => g.items).find((i) => text(i.label) === label)!;
  const checkedLabels = (scope: Scope) =>
    groups.flatMap((g) => g.items).filter((i) => scopeItemChecked(scope, i)).map((i) => text(i.label));

  it("all ⇒ only 'All bookings' is ticked; a group tick shows on the group and its members", () => {
    expect(checkedLabels(ALL)).toEqual(["bookings.scope.all"]);
    expect(checkedLabels(some("all", []))).toEqual(["appointments.scope.all", "Anna", "Ben"]);
    expect(checkedLabels(some([anna.id], [studio.id]))).toEqual(["Anna", "Studio A"]);
  });
  it("ticking a person from All narrows to that person", () => {
    expect(toggleScopeItem(ALL, item("Anna"), people, spaces)).toEqual(some([anna.id], []));
  });
  it("ticking a second thing adds it; unticking removes it; unticking the last ⇒ all", () => {
    const annaOnly = some([anna.id], []);
    const both = toggleScopeItem(annaOnly, item("Studio A"), people, spaces);
    expect(both).toEqual(some([anna.id], [studio.id]));
    expect(toggleScopeItem(both, item("Anna"), people, spaces)).toEqual(some([], [studio.id]));
    expect(toggleScopeItem(annaOnly, item("Anna"), people, spaces)).toEqual(ALL);
  });
  it("ticking every member of a group becomes the group; the last group ticked ⇒ all", () => {
    expect(toggleScopeItem(some([anna.id], []), item("Ben"), people, spaces)).toEqual(some("all", []));
    expect(toggleScopeItem(some("all", [studio.id]), item("Flat 1"), people, spaces)).toEqual(ALL);
  });
  it("unticking one member of a ticked group keeps the others", () => {
    expect(toggleScopeItem(some("all", []), item("Anna"), people, spaces)).toEqual(some([ben.id], []));
  });
  it("the group entry ticks or clears its whole group", () => {
    expect(toggleScopeItem(some([anna.id], [studio.id]), item("appointments.scope.all"), people, spaces)).toEqual(
      some("all", [studio.id]),
    );
    expect(toggleScopeItem(some("all", [studio.id]), item("appointments.scope.all"), people, spaces)).toEqual(
      some([], [studio.id]),
    );
    expect(toggleScopeItem(some([anna.id], []), item("spaces.scope.all"), people, spaces)).toEqual(some([anna.id], "all"));
  });
  it("'All bookings' always resets", () => {
    expect(toggleScopeItem(some([anna.id], [studio.id]), item("bookings.scope.all"), people, spaces)).toEqual(ALL);
    expect(toggleScopeItem(ALL, item("bookings.scope.all"), people, spaces)).toEqual(ALL);
  });
  it("a solo person's 'Appointments' entry is the group toggle", () => {
    const solo = scopeItems([anna], spaces)!;
    const appts = solo.flatMap((g) => g.items).find((i) => text(i.label) === "appointments.scope.group")!;
    expect(toggleScopeItem(ALL, appts, [anna], spaces)).toEqual(some("all", []));
    expect(scopeItemChecked(some("all", []), appts)).toBe(true);
  });
});

describe("scopeSides (which kinds a scope shows at all)", () => {
  it("answers per side, treating a vacuous 'all' as nothing", () => {
    expect(scopeSides(ALL, people, spaces)).toEqual({ people: true, spaces: true });
    expect(scopeSides(some("all", []), people, spaces)).toEqual({ people: true, spaces: false });
    expect(scopeSides(some([], [flat.id]), people, spaces)).toEqual({ people: false, spaces: true });
    expect(scopeSides(some([anna.id], "all"), people, [])).toEqual({ people: true, spaces: false });
    expect(scopeSides(ALL, people, [])).toEqual({ people: true, spaces: false });
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
    expect(applyScope(rows, ALL)).toBe(rows);
  });
  it("a people side keeps those people's appointments; a spaces side those spaces' bookings", () => {
    expect(ids(applyScope(rows, some("all", [])))).toEqual(["a1", "b1"]);
    expect(ids(applyScope(rows, some([ben.id], [])))).toEqual(["b1"]);
    expect(ids(applyScope(rows, some([], "all")))).toEqual(["s1", "f1"]);
    expect(ids(applyScope(rows, some([], [flat.id])))).toEqual(["f1"]);
  });
  it("a mix is the union", () => {
    expect(ids(applyScope(rows, some([anna.id], [flat.id])))).toEqual(["a1", "f1"]);
    expect(ids(applyScope(rows, some("all", [studio.id])))).toEqual(["a1", "b1", "s1"]);
  });
});

describe("scopeHoursOwners (whose hours hatch the week)", () => {
  const staff = [anna, ben];
  it("all and every-person scopes ⇒ every active member, as today", () => {
    expect(scopeHoursOwners(ALL, staff, staff, spaces)).toEqual([{ staffId: anna.id }, { staffId: ben.id }]);
    expect(scopeHoursOwners(some("all", []), staff, staff, spaces)).toEqual([{ staffId: anna.id }, { staffId: ben.id }]);
  });
  it("some people ⇒ just them; with spaces ⇒ them plus the hourly spaces", () => {
    expect(scopeHoursOwners(some([ben.id], []), staff, staff, spaces)).toEqual([{ staffId: ben.id }]);
    expect(scopeHoursOwners(some([ben.id], "all"), staff, staff, spaces)).toEqual([
      { staffId: ben.id },
      { rentalOfferingId: studio.id },
    ]);
  });
  it("spaces alone ⇒ the hourly ones; one hourly space ⇒ it alone", () => {
    expect(scopeHoursOwners(some([], "all"), staff, staff, spaces)).toEqual([{ rentalOfferingId: studio.id }]);
    expect(scopeHoursOwners(some([], [studio.id]), staff, staff, spaces)).toEqual([{ rentalOfferingId: studio.id }]);
  });
  it("a nights/days-only scope has no clock hours ⇒ the members' hours, as a rentals-only week draws today", () => {
    expect(scopeHoursOwners(some([], [flat.id]), staff, staff, spaces)).toEqual([{ staffId: anna.id }, { staffId: ben.id }]);
    expect(scopeHoursOwners(some([], "all"), staff, staff, [flat])).toEqual([{ staffId: anna.id }, { staffId: ben.id }]);
  });
});

describe("scopedSpace (what New booking starts on when only spaces show)", () => {
  it("one space ⇒ that space; every space ⇒ the first hourly one, else the first", () => {
    expect(scopedSpace(some([], [flat.id]), people, spaces)?.id).toBe(flat.id);
    expect(scopedSpace(some([], "all"), people, [flat, studio])?.id).toBe(studio.id);
    expect(scopedSpace(some([], "all"), people, [flat])?.id).toBe(flat.id);
    expect(scopedSpace(some([], [flat.id, studio.id]), people, spaces)?.id).toBe(studio.id);
  });
  it("a rentals-only org's vacuous people side does not get in the way", () => {
    expect(scopedSpace(some("all", [studio.id]), [], spaces)?.id).toBe(studio.id);
  });
  it("any scope that shows people ⇒ none (the dialog's own defaults apply)", () => {
    expect(scopedSpace(ALL, people, spaces)).toBeNull();
    expect(scopedSpace(some("all", []), people, spaces)).toBeNull();
    expect(scopedSpace(some([anna.id], [studio.id]), people, spaces)).toBeNull();
  });
});

describe("review follow-ups (shapes the demo org cannot exercise)", () => {
  it("a rentals-only org's hourly-space scope draws the room's hours, not the hidden staff row's too", () => {
    // people = [] (the org sells no appointments) makes the people side vacuously "all"
    const scope = parseScope({ show: `space:${studio.id}` }, [], spaces);
    expect(scope).toEqual(some("all", [studio.id]));
    expect(scopeHoursOwners(scope, [anna], [], spaces)).toEqual([{ rentalOfferingId: studio.id }]);
    // a nights-only pick there still falls back to the members' hours
    expect(scopeHoursOwners(some("all", [flat.id]), [anna], [], spaces)).toEqual([{ staffId: anna.id }]);
  });
  it("a sole space reads by its name on the trigger, as it does on the menu", () => {
    const scope = parseScope({ show: `space:${studio.id}` }, [anna], [studio]);
    expect(scope).toEqual(some([], "all"));
    expect(text(scopeLabel(scope, [anna], [studio]))).toBe("Studio A");
    // people deliberately stay the kind (U3: the sole person stays nameless)
    expect(text(scopeLabel(some("all", []), [anna], [studio]))).toBe("appointments.scope.group");
  });
  it("an item naming nobody listed changes nothing", () => {
    const stray = { key: "staff:zzz", label: { name: "Zed" }, kind: "staff" as const, id: "zzz" };
    expect(toggleScopeItem(ALL, stray, [anna], spaces)).toEqual(ALL);
    expect(toggleScopeItem(some([anna.id], []), stray, people, spaces)).toEqual(some([anna.id], []));
  });
  it("tokens are trimmed", () => {
    expect(parseScope({ show: "appointments, spaces" }, people, spaces)).toEqual(ALL);
    expect(parseScope({ show: ` staff:${anna.id} , space:${flat.id} ` }, people, spaces)).toEqual(
      some([anna.id], [flat.id]),
    );
  });
});
