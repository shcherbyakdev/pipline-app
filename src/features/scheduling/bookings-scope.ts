import type { AdminBooking } from "@/features/scheduling/queries";
import type { AvailabilityOwner } from "@/features/scheduling/schema";

/* What the Bookings page is looking at. One selector, one `?show=` param
   (Acuity's "All calendars", Fresha's "Team" — a single scope grouped by
   kind, never a kind toggle beside a person filter), and it multi-selects:
   any mix of people and spaces, Google-Calendar style. Pure: parsing, the
   query it writes back, the ticks, and the words on the trigger are all
   tested without a page around them.

   A side ("all" | ids) is normalised against what the org lists: every
   member named one by one IS the group, both groups IS everything, and
   nothing at all IS everything too (a week showing nothing is no lens).
   An org without a kind has that side vacuously "all" — scopeSides() is
   how callers ask what a scope really shows. */
export type Scope =
  | { kind: "all" }
  | { kind: "some"; people: "all" | string[]; spaces: "all" | string[] };

export type ScopeParams = { show?: string; staff?: string };
/** Structural minimums — a StaffRow / an OfferingOption satisfy them. */
export type PersonLike = { id: string; name: string; color: string };
export type SpaceLike = { id: string; name: string; rangeMode?: string };

/** Words this module hands the UI, unrendered (i18n Wave 3): a person's or
    space's name as-is, a group or "All bookings" as a root message key, and
    "{n} selected" as a count for `bookings.scope.selected`. */
export type ScopeKey =
  | "bookings.scope.all"
  | "appointments.scope.group"
  | "appointments.scope.all"
  | "spaces.scope.group"
  | "spaces.scope.all";
export type ScopeText = { name: string } | { key: ScopeKey } | { count: number };

const ALL: Scope = { kind: "all" };
const ALL_BOOKINGS: ScopeText = { key: "bookings.scope.all" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The org-normalised scope for two selected-id sets. */
function normalise(
  peopleSel: ReadonlySet<string>,
  spacesSel: ReadonlySet<string>,
  people: readonly { id: string }[],
  spaces: readonly { id: string }[],
): Scope {
  // Only listed ids count, in the list's order — the seam never trusts an id
  // it was not handed (a stray token, an item for someone since deactivated).
  const side = (sel: ReadonlySet<string>, listed: readonly { id: string }[]): "all" | string[] => {
    const ids = listed.filter((x) => sel.has(x.id)).map((x) => x.id);
    return ids.length === listed.length ? "all" : ids;
  };
  const p = side(peopleSel, people);
  const s = side(spacesSel, spaces);
  const empty = (x: "all" | string[], listed: readonly unknown[]) => (x === "all" ? listed.length === 0 : x.length === 0);
  if (empty(p, people) && empty(s, spaces)) return ALL;
  return p === "all" && s === "all" ? ALL : { kind: "some", people: p, spaces: s };
}

/** `?show=` first — comma-separated tokens `appointments`, `spaces`,
    `staff:<id>`, `space:<id>` — with the pre-selector `?staff=a,b` as a
    fallback. Anything that names nothing listed — a stale link, another
    org's id, a kind the org doesn't sell — quietly drops out (the page's
    forgiving rule, never a 404). Callers pass ACTIVE people (only when the
    org offers appointments) and ACTIVE spaces. */
export function parseScope(
  params: ScopeParams,
  people: readonly PersonLike[],
  spaces: readonly SpaceLike[],
): Scope {
  const peopleSel = new Set<string>();
  const spacesSel = new Set<string>();
  const person = (id: string) => people.some((p) => p.id === id);
  const space = (id: string) => spaces.some((s) => s.id === id);
  if (params.show) {
    for (const token of params.show.split(",").map((t) => t.trim())) {
      if (token === "appointments") people.forEach((p) => peopleSel.add(p.id));
      else if (token === "spaces") spaces.forEach((s) => spacesSel.add(s.id));
      else if (token.startsWith("staff:") && person(token.slice(6))) peopleSel.add(token.slice(6));
      else if (token.startsWith("space:") && space(token.slice(6))) spacesSel.add(token.slice(6));
    }
  } else if (params.staff) {
    for (const id of params.staff.split(",").map((s) => s.trim())) {
      if (UUID_RE.test(id) && person(id)) peopleSel.add(id);
    }
  }
  return normalise(peopleSel, spacesSel, people, spaces);
}

/** The `show=` tokens for a scope, or "" for everything. A vacuous side
    (a kind the org doesn't sell) leaves no token behind. */
export function scopeValue(
  scope: Scope,
  people: readonly { id: string }[],
  spaces: readonly { id: string }[],
): string {
  if (scope.kind === "all") return "";
  const tokens: string[] = [];
  if (scope.people === "all") {
    if (people.length > 0) tokens.push("appointments");
  } else tokens.push(...scope.people.map((id) => `staff:${id}`));
  if (scope.spaces === "all") {
    if (spaces.length > 0) tokens.push("spaces");
  } else tokens.push(...scope.spaces.map((id) => `space:${id}`));
  return tokens.join(",");
}

/** The query fragment the week arrows, Today and the switcher carry —
    "show=…" or "" so callers can `&`-append it. */
export function scopeQuery(
  scope: Scope,
  people: readonly { id: string }[],
  spaces: readonly { id: string }[],
): string {
  const value = scopeValue(scope, people, spaces);
  return value ? `show=${value}` : "";
}

/** Which kinds a scope shows at all — a vacuous "all" counts for nothing. */
export function scopeSides(
  scope: Scope,
  people: readonly { id: string }[],
  spaces: readonly { id: string }[],
): { people: boolean; spaces: boolean } {
  const has = (side: "all" | string[], listed: readonly { id: string }[]) =>
    side === "all" ? listed.length > 0 : side.length > 0;
  if (scope.kind === "all") return { people: people.length > 0, spaces: spaces.length > 0 };
  return { people: has(scope.people, people), spaces: has(scope.spaces, spaces) };
}

/** The names a scope selects — a whole group is one name, except that a
    sole space keeps its own (it is listed by name on the menu); a sole
    person stays the kind (U3: the sole person stays nameless). */
function scopeNames(scope: Scope, people: readonly PersonLike[], spaces: readonly SpaceLike[]): ScopeText[] {
  if (scope.kind === "all") return [];
  const names: ScopeText[] = [];
  if (scope.people === "all") {
    if (people.length > 0) names.push({ key: "appointments.scope.group" });
  } else names.push(...people.filter((p) => scope.people.includes(p.id)).map((p) => ({ name: p.name })));
  if (scope.spaces === "all") {
    if (spaces.length === 1) names.push({ name: spaces[0].name });
    else if (spaces.length > 1) names.push({ key: "spaces.scope.group" });
  } else names.push(...spaces.filter((s) => scope.spaces.includes(s.id)).map((s) => ({ name: s.name })));
  return names;
}

/** What the trigger reads: one thing by name, several by count. */
export function scopeLabel(
  scope: Scope,
  people: readonly PersonLike[],
  spaces: readonly SpaceLike[],
): ScopeText {
  const names = scopeNames(scope, people, spaces);
  if (names.length === 0) return ALL_BOOKINGS;
  if (names.length === 1) return names[0];
  return { count: names.length };
}

type ScopeItemBase = {
  /** Stable key for React and the tests. */
  key: string;
  label: ScopeText;
  /** A person's colour dot. */
  color?: string;
  /** Marked with the house icon. */
  space?: true;
};
/** What ticking an item does: reset, tick a whole group, or one member.
    One member per group kind so `kind` narrows all the way to the id. */
export type ScopeItem =
  | (ScopeItemBase & { kind: "all"; id?: undefined })
  | (ScopeItemBase & { kind: "appointments"; id?: undefined })
  | (ScopeItemBase & { kind: "spaces"; id?: undefined })
  | (ScopeItemBase & { kind: "staff" | "space"; id: string });
export type ScopeGroup = { label: ScopeText | null; items: ScopeItem[] };

/** The menu, per org shape (the solo rule, generalised): a group's
    "All appointments"/"All spaces" entry only when the OTHER channel is
    on the menu too (else it is "All bookings" twice) and the group has two
    or more members; a sole person is listed as the kind (U3: the sole
    person stays nameless) and ticks the whole group, a sole space by its
    name. Null when fewer than three entries would result — then every
    choice is the whole week and the control has nothing to say. */
export function scopeItems(
  people: readonly PersonLike[],
  spaces: readonly SpaceLike[],
): ScopeGroup[] | null {
  const both = people.length > 0 && spaces.length > 0;
  const groups: ScopeGroup[] = [{ label: null, items: [{ key: "all", label: ALL_BOOKINGS, kind: "all" }] }];
  if (people.length > 0) {
    const items: ScopeItem[] = [];
    if (people.length === 1) {
      items.push({ key: "appointments", label: { key: "appointments.scope.group" }, kind: "appointments" });
    } else {
      if (both) items.push({ key: "appointments", label: { key: "appointments.scope.all" }, kind: "appointments" });
      for (const p of people) items.push({ key: `staff:${p.id}`, label: { name: p.name }, kind: "staff", id: p.id, color: p.color });
    }
    groups.push({ label: both ? { key: "appointments.scope.group" } : null, items });
  }
  if (spaces.length > 0) {
    const items: ScopeItem[] = [];
    if (both && spaces.length > 1) items.push({ key: "spaces", label: { key: "spaces.scope.all" }, kind: "spaces" });
    for (const s of spaces) items.push({ key: `space:${s.id}`, label: { name: s.name }, kind: "space", id: s.id, space: true });
    groups.push({ label: both ? { key: "spaces.scope.group" } : null, items });
  }
  const count = groups.reduce((n, g) => n + g.items.length, 0);
  if (count < 3) return null;
  // Single-channel orgs read as one flat list.
  return both ? groups : [{ label: null, items: groups.flatMap((g) => g.items) }];
}

/** Whether an item shows a tick: a group when it is wholly selected, a
    member when its group is or it is named. "All bookings" only for the
    whole week. */
export function scopeItemChecked(scope: Scope, item: ScopeItem): boolean {
  if (item.kind === "all") return scope.kind === "all";
  if (scope.kind === "all") return false;
  if (item.kind === "appointments") return scope.people === "all";
  if (item.kind === "spaces") return scope.spaces === "all";
  const side = item.kind === "staff" ? scope.people : scope.spaces;
  return side === "all" || side.includes(item.id);
}

/** The scope after ticking an item. "All bookings" resets; a group entry
    ticks or clears its whole group; a member joins or leaves — leaving a
    wholly ticked group keeps the others. The result is normalised, so
    ticking the last member makes the group and ticking the last group (or
    unticking the last thing) makes the whole week. */
export function toggleScopeItem(
  scope: Scope,
  item: ScopeItem,
  people: readonly PersonLike[],
  spaces: readonly SpaceLike[],
): Scope {
  if (item.kind === "all") return ALL;
  const expand = (side: "all" | string[], listed: readonly { id: string }[]) =>
    new Set(side === "all" ? listed.map((x) => x.id) : side);
  const peopleSel = scope.kind === "all" ? new Set<string>() : expand(scope.people, people);
  const spacesSel = scope.kind === "all" ? new Set<string>() : expand(scope.spaces, spaces);
  if (item.kind === "appointments" || item.kind === "spaces") {
    const sel = item.kind === "appointments" ? peopleSel : spacesSel;
    if (scopeItemChecked(scope, item)) sel.clear();
    else (item.kind === "appointments" ? people : spaces).forEach((x) => sel.add(x.id));
  } else {
    const sel = item.kind === "staff" ? peopleSel : spacesSel;
    if (sel.has(item.id)) sel.delete(item.id);
    else sel.add(item.id);
  }
  return normalise(peopleSel, spacesSel, people, spaces);
}

/** One org-week (or the list) of rows, narrowed in memory: a people side
    keeps those people's appointments, a spaces side those spaces'
    bookings, and a mix is the union. `all` hands the array back untouched. */
export function applyScope(bookings: AdminBooking[], scope: Scope): AdminBooking[] {
  if (scope.kind === "all") return bookings;
  const { people, spaces } = scope;
  return bookings.filter((b) =>
    b.rentalUnitId === null
      ? people === "all" || (b.staffId !== null && people.includes(b.staffId))
      : spaces === "all" || (b.rentalOfferingId !== null && spaces.includes(b.rentalOfferingId)),
  );
}

const isHourly = (s: SpaceLike) => s.rangeMode === "hours";

/** Whose hours hatch the week: the scope's people (every active member
    for `all`, as today) plus its HOURLY spaces — a nights/days stay has no
    clock hours, so a scope with no owner at all falls back to the members'
    hours, which is what a rentals-only week has always drawn. `staff` is
    every active member, whatever the org sells; `people` only those on the
    menu, so a rentals-only org's vacuous people side adds nobody and its
    room's week is hatched by the room alone. */
export function scopeHoursOwners(
  scope: Scope,
  staff: readonly { id: string }[],
  people: readonly { id: string }[],
  spaces: readonly SpaceLike[],
): AvailabilityOwner[] {
  const everyone = (): AvailabilityOwner[] => staff.map((s) => ({ staffId: s.id }));
  if (scope.kind === "all") return everyone();
  const owners: AvailabilityOwner[] =
    scope.people === "all"
      ? people.length > 0
        ? everyone()
        : []
      : scope.people.map((staffId) => ({ staffId }));
  for (const s of spaces) {
    if (isHourly(s) && (scope.spaces === "all" || scope.spaces.includes(s.id))) {
      owners.push({ rentalOfferingId: s.id });
    }
  }
  return owners.length > 0 ? owners : everyone();
}

/** When only spaces show, the space a New booking (toolbar or drag) starts
    on: the one space, else the first hourly one selected, else the first.
    A scope showing any person ⇒ null — the dialog's own defaults apply. */
export function scopedSpace<S extends SpaceLike>(
  scope: Scope,
  people: readonly { id: string }[],
  spaces: readonly S[],
): S | null {
  if (scope.kind === "all" || scopeSides(scope, people, spaces).people) return null;
  const chosen = scope.spaces === "all" ? spaces : spaces.filter((s) => scope.spaces.includes(s.id));
  return chosen.find(isHourly) ?? chosen[0] ?? null;
}
