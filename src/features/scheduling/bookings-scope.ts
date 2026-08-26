import { APPOINTMENTS, SPACES } from "@/features/orgs/vocab";
import type { AdminBooking } from "@/features/scheduling/queries";
import type { AvailabilityOwner } from "@/features/scheduling/schema";

/* What the Bookings page is looking at. One selector, one `?show=` param
   (Acuity's "All calendars", Fresha's "Team" — a single scope grouped by
   kind, never a kind toggle beside a person filter). Pure: parsing, the
   query it writes back, and the words on the trigger are all tested
   without a page around them. */
export type Scope =
  | { kind: "all" }
  /** `staffIds` null = every person's appointments; a list = just theirs. */
  | { kind: "appointments"; staffIds: string[] | null }
  /** `offeringId` null = every space; an id = one space (any range mode). */
  | { kind: "spaces"; offeringId: string | null };

export type ScopeParams = { show?: string; staff?: string };
/** Structural minimums — a StaffRow / an OfferingOption satisfy them. */
export type PersonLike = { id: string; name: string; color: string };
export type SpaceLike = { id: string; name: string; rangeMode?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids from a comma list that name a listed person, in the list's order. */
function listedPeople(csv: string, people: readonly PersonLike[]): string[] {
  const wanted = csv.split(",").map((id) => id.trim()).filter((id) => UUID_RE.test(id));
  return people.filter((p) => wanted.includes(p.id)).map((p) => p.id);
}

/** `?show=` first, the pre-selector `?staff=a,b` as a fallback. Anything
    that names nothing listed — a stale link, another org's id, a kind the
    org doesn't sell — quietly means "everything" (the page's forgiving
    rule, never a 404). Callers pass ACTIVE people (only when the org offers
    appointments) and ACTIVE spaces. */
export function parseScope(
  params: ScopeParams,
  people: readonly PersonLike[],
  spaces: readonly SpaceLike[],
): Scope {
  const show = params.show ?? "";
  if (show === "appointments" && people.length > 0) return { kind: "appointments", staffIds: null };
  if (show === "spaces" && spaces.length > 0) return { kind: "spaces", offeringId: null };
  if (show.startsWith("staff:")) {
    const ids = listedPeople(show.slice("staff:".length), people);
    if (ids.length > 0) return { kind: "appointments", staffIds: ids };
  }
  if (show.startsWith("space:")) {
    const id = show.slice("space:".length);
    if (spaces.some((s) => s.id === id)) return { kind: "spaces", offeringId: id };
  }
  if (params.staff) {
    // The old chip row's URL: a real narrowing is a lens; naming everyone
    // (or nobody real) was, and is, the whole week.
    const ids = listedPeople(params.staff, people);
    if (ids.length > 0 && ids.length < people.length) return { kind: "appointments", staffIds: ids };
  }
  return { kind: "all" };
}

/** The `show=` value for a scope, or "" for everything. */
export function scopeValue(scope: Scope): string {
  switch (scope.kind) {
    case "all":
      return "";
    case "appointments":
      return scope.staffIds === null ? "appointments" : `staff:${scope.staffIds.join(",")}`;
    case "spaces":
      return scope.offeringId === null ? "spaces" : `space:${scope.offeringId}`;
  }
}

/** The query fragment the week arrows, Today and the switcher carry —
    "show=…" or "" so callers can `&`-append it. */
export function scopeQuery(scope: Scope): string {
  const value = scopeValue(scope);
  return value ? `show=${value}` : "";
}

/** What the trigger reads: the lens, named. */
export function scopeLabel(
  scope: Scope,
  people: readonly PersonLike[],
  spaces: readonly SpaceLike[],
): string {
  switch (scope.kind) {
    case "all":
      return ALL_BOOKINGS;
    case "appointments":
      if (scope.staffIds === null) return APPOINTMENTS.scope.group;
      if (scope.staffIds.length === 1) {
        return people.find((p) => p.id === scope.staffIds![0])?.name ?? APPOINTMENTS.scope.group;
      }
      return `${scope.staffIds.length} people`;
    case "spaces":
      if (scope.offeringId === null) return SPACES.scope.group;
      return spaces.find((s) => s.id === scope.offeringId)?.name ?? SPACES.scope.group;
  }
}

export const ALL_BOOKINGS = "All bookings";

export type ScopeItem = {
  /** The radio value — the `show=` token, or "all". */
  value: string;
  label: string;
  scope: Scope;
  /** A person's colour dot. */
  color?: string;
  /** Marked with the house icon. */
  space?: true;
};
export type ScopeGroup = { label: string | null; items: ScopeItem[] };

const item = (scope: Scope, label: string, extra: Partial<ScopeItem> = {}): ScopeItem => ({
  value: scopeValue(scope) || "all",
  label,
  scope,
  ...extra,
});

/** The menu, per org shape (the solo rule, generalised): a group's
    "All appointments"/"All spaces" entry only when the OTHER channel is
    on the menu too (else it is "All bookings" twice) and the group has two
    or more members; a sole person is listed as the kind (U3: the sole
    person stays nameless), a sole space by its name. Null when fewer than
    three entries would result — then every choice is the whole week and
    the control has nothing to say. */
export function scopeItems(
  people: readonly PersonLike[],
  spaces: readonly SpaceLike[],
): ScopeGroup[] | null {
  const both = people.length > 0 && spaces.length > 0;
  const groups: ScopeGroup[] = [{ label: null, items: [item({ kind: "all" }, ALL_BOOKINGS)] }];
  if (people.length > 0) {
    const items: ScopeItem[] = [];
    if (people.length === 1) {
      items.push(item({ kind: "appointments", staffIds: null }, APPOINTMENTS.scope.group));
    } else {
      if (both) items.push(item({ kind: "appointments", staffIds: null }, APPOINTMENTS.scope.all));
      for (const p of people) items.push(item({ kind: "appointments", staffIds: [p.id] }, p.name, { color: p.color }));
    }
    groups.push({ label: both ? APPOINTMENTS.scope.group : null, items });
  }
  if (spaces.length > 0) {
    const items: ScopeItem[] = [];
    if (both && spaces.length > 1) items.push(item({ kind: "spaces", offeringId: null }, SPACES.scope.all));
    for (const s of spaces) items.push(item({ kind: "spaces", offeringId: s.id }, s.name, { space: true }));
    groups.push({ label: both ? SPACES.scope.group : null, items });
  }
  const count = groups.reduce((n, g) => n + g.items.length, 0);
  if (count < 3) return null;
  // Single-channel orgs read as one flat list.
  return both ? groups : [{ label: null, items: groups.flatMap((g) => g.items) }];
}

/** One org-week (or the list) of rows, narrowed in memory. `all` hands the
    array back untouched. */
export function applyScope(bookings: AdminBooking[], scope: Scope): AdminBooking[] {
  switch (scope.kind) {
    case "all":
      return bookings;
    case "appointments": {
      const ids = scope.staffIds === null ? null : new Set(scope.staffIds);
      return bookings.filter(
        (b) => b.rentalUnitId === null && (ids === null || (b.staffId !== null && ids.has(b.staffId))),
      );
    }
    case "spaces":
      return bookings.filter(
        (b) => b.rentalUnitId !== null && (scope.offeringId === null || b.rentalOfferingId === scope.offeringId),
      );
  }
}

const isHourly = (s: SpaceLike) => s.rangeMode === "hours";

/** Whose hours hatch the week. People scopes ⇒ those people (every active
    member for `all`, as today). Space scopes ⇒ the scoped HOURLY spaces —
    a nights/days stay has no clock hours, so a scope with none falls back
    to the members' hours, which is what a rentals-only week has always
    drawn. `staff` is every active member, whatever the org sells. */
export function scopeHoursOwners(
  scope: Scope,
  staff: readonly { id: string }[],
  spaces: readonly SpaceLike[],
): AvailabilityOwner[] {
  const everyone = (): AvailabilityOwner[] => staff.map((s) => ({ staffId: s.id }));
  switch (scope.kind) {
    case "all":
      return everyone();
    case "appointments":
      return scope.staffIds === null ? everyone() : scope.staffIds.map((staffId) => ({ staffId }));
    case "spaces": {
      const hourly = spaces.filter(
        (s) => isHourly(s) && (scope.offeringId === null || s.id === scope.offeringId),
      );
      return hourly.length > 0 ? hourly.map((s) => ({ rentalOfferingId: s.id })) : everyone();
    }
  }
}

/** Under a space scope, the space a New booking (toolbar or drag) starts
    on: the scoped one, else the first hourly space, else the first space.
    Any other scope ⇒ null — the dialog's own defaults apply. */
export function scopedSpace<S extends SpaceLike>(scope: Scope, spaces: readonly S[]): S | null {
  if (scope.kind !== "spaces") return null;
  if (scope.offeringId !== null) return spaces.find((s) => s.id === scope.offeringId) ?? null;
  return spaces.find(isHourly) ?? spaces[0] ?? null;
}
