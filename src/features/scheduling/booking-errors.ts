// Client-facing copy for the two ways a slot can be lost between the times
// list and the confirm button, plus the rule for choosing between them.
//
// Its own module rather than consts inside public-actions.ts because the rule
// is the kind that regresses silently: a `"use server"` file may only export
// async functions (every export there becomes a callable endpoint), so a pure
// decision living next to the actions could not be unit-tested at all.

// Keys under `errors.*` (messages/*.json); the action resolves them in the
// page's locale (src/i18n/public.ts publicErrors).
export const SLOT_TAKEN = "slotTaken";
export const STAFF_UNAVAILABLE = "staffUnavailable";
export type SlotLostKey = typeof SLOT_TAKEN | typeof STAFF_UNAVAILABLE;

/**
 * A named `staffId` is NOT evidence that the org has a team: the widget sends
 * the single eligible person's id even in a solo org, so the RPC does its
 * strict named check instead of auto-assigning. Only the active-staff count
 * separates the two, and a solo org must keep the wording it had before the
 * team slice existed.
 */
export function slotLostMessage(staffId: string, activeStaffCount: number): SlotLostKey {
  return staffId !== "any" && activeStaffCount > 1 ? STAFF_UNAVAILABLE : SLOT_TAKEN;
}
