import type { createClient } from "@/lib/supabase/server";

/* The week a bookable owner starts with: Mon–Fri, 09:00–17:00 — the same
   window the editor's "+" gives an empty day (time-options.ts nextInterval),
   and what Calendly and Cal.com open with.

   A new account used to arrive with no availability rows at all, so every
   day read "Unavailable", the public page offered nothing, and the owner had
   to click "+" on each weekday to get going. The rows are seeded where a
   bookable owner is minted instead (onboarding's first team member, a new
   hourly space); a new team member needs nothing here because create_staff
   (0041) already copies the first active member's schedule. Nothing about
   this is retroactive — an owner whose week is empty gets the same week from
   the editor's one-click prompt (applyDefaultHours). */

/** 0 is Sunday (matching `weekday` in availability_rules and the editor's
    WEEKDAY_ORDER), so 1–5 is Monday to Friday. */
export const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5] as const;
export const DEFAULT_START_TIME = "09:00";
export const DEFAULT_END_TIME = "17:00";
/** How the editor's prompt offers the week. Plain 24h rather than
    formatTime: this renders on the server too, and a locale-formatted label
    would risk a hydration mismatch. */
export const DEFAULT_WEEK_LABEL = `Mon–Fri, ${DEFAULT_START_TIME}–${DEFAULT_END_TIME}`;

/** Whose week: a staff member XOR an hours rental offering (0056's XOR
    CHECK). Callers taking user input parse `availabilityOwnerInput` first;
    the creation paths pass an id they just minted. */
export type HoursOwner = { staffId?: string; rentalOfferingId?: string };

export type DefaultHourRow = {
  org_id: string;
  staff_id: string | null;
  rental_offering_id: string | null;
  weekday: number;
  start_time: string;
  end_time: string;
};

/** Pure: the rows a default week is made of, ready to insert. */
export function defaultHourRows(orgId: string, owner: HoursOwner): DefaultHourRow[] {
  return DEFAULT_WEEKDAYS.map((weekday) => ({
    org_id: orgId,
    staff_id: owner.staffId ?? null,
    rental_offering_id: owner.rentalOfferingId ?? null,
    weekday,
    start_time: DEFAULT_START_TIME,
    end_time: DEFAULT_END_TIME,
  }));
}

/** One insert, so the week lands whole or not at all. Returns the error for
    the caller to map — 23P01 means the owner already had overlapping hours
    (0035's EXCLUDE guard) — or null when the week is in. */
export async function seedDefaultHours(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  owner: HoursOwner,
): Promise<{ message: string; code?: string } | null> {
  const { error } = await supabase.from("availability_rules").insert(defaultHourRows(orgId, owner));
  return error ?? null;
}
