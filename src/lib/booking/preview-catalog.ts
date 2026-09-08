import type { OrgMode } from "@/features/orgs/mode";
import type { OfferingRow } from "@/features/rentals/queries";
import { toPreviewServices } from "@/features/scheduling/preview-services";
import type { PublicOffering, PublicService } from "@/lib/booking/public";

/* What the admin's live previews (Booking page, Website embed) hand the
   widget. Mirrors listPublicCatalog's mode rules so a preview never shows a
   channel the public page hides: a rentals-only org sees no services (not
   even the canned stand-in), an appointments-only org sees no rentals. Real
   bookable rows where they exist (a space needs an active unit to be listed,
   exactly as on the public page); a canned stand-in per channel when the org
   has nothing yet, so appearance can be judged before the first one. The
   pages feed this the org's one channel (0073). The preview itself never
   fetches — rental cards render but stay inert. */

type ServiceRow = PublicService & { active: boolean };

/** The stand-in's id — callers that must not treat it as a real offering
    (the Spaces inspector's photo rows) filter on this. */
export const PREVIEW_OFFERING_ID = "preview-offering";

// Far-future, unpriced-deposit stand-in; the id is the "is this canned"
// marker (preview-services.ts's `preview-service` precedent).
const CANNED_PREVIEW_OFFERING: PublicOffering = {
  id: PREVIEW_OFFERING_ID,
  name: "Studio A",
  description: null,
  kind: "space",
  rangeMode: "nights",
  startTime: "15:00",
  endTime: "11:00",
  minStay: 1,
  maxStay: null,
  turnoverDays: 0,
  minNoticeDays: 0,
  bookingWindowDays: 180,
  unitSelection: "auto",
  slotIncrementMin: null,
  minDurationMin: null,
  maxDurationMin: null,
  turnoverMin: 0,
  minNoticeMin: 0,
  priceCents: 20000,
  pricingMode: "per_unit",
  depositType: "none",
  depositValue: null,
  cancelPolicy: [],
  termsText: null,
  requiresApproval: false,
  pricing: null,
};

// The public projection of an admin row — listed field by field so an
// admin-only column (active, sortOrder, unitCount) can't ride into the
// widget by structural accident.
function toPublicOffering(o: OfferingRow): PublicOffering {
  return {
    id: o.id,
    name: o.name,
    description: o.description,
    kind: o.kind,
    rangeMode: o.rangeMode,
    startTime: o.startTime,
    endTime: o.endTime,
    minStay: o.minStay,
    maxStay: o.maxStay,
    turnoverDays: o.turnoverDays,
    minNoticeDays: o.minNoticeDays,
    bookingWindowDays: o.bookingWindowDays,
    unitSelection: o.unitSelection,
    slotIncrementMin: o.slotIncrementMin,
    minDurationMin: o.minDurationMin,
    maxDurationMin: o.maxDurationMin,
    turnoverMin: o.turnoverMin,
    minNoticeMin: o.minNoticeMin,
    priceCents: o.priceCents,
    pricingMode: o.pricingMode,
    depositType: o.depositType,
    depositValue: o.depositValue,
    cancelPolicy: o.cancelPolicy,
    termsText: o.termsText,
    requiresApproval: o.requiresApproval,
    pricing: o.pricing,
  };
}

/** Listed on the public page: active, with at least one active unit
    (listPublicOfferings; the setup checklist's "bookable" count). */
export function isBookableOffering(o: Pick<OfferingRow, "active" | "activeUnitCount">): boolean {
  return o.active && o.activeUnitCount > 0;
}

function toPreviewOfferings(offerings: OfferingRow[]): PublicOffering[] {
  // S6: equipment is never listed on its own — it rides a room booking, and
  // the public catalogue drops it too (listPublicOfferings' .neq on kind).
  const bookable = offerings
    .filter((o) => o.kind !== "equipment" && isBookableOffering(o))
    .map(toPublicOffering);
  return bookable.length > 0 ? bookable : [CANNED_PREVIEW_OFFERING];
}

export function toPreviewCatalog({
  mode,
  services,
  offerings,
}: {
  mode: OrgMode;
  services: ServiceRow[];
  offerings: OfferingRow[];
}): { services: PublicService[]; offerings: PublicOffering[] } {
  return {
    services: mode.offersAppointments ? toPreviewServices(services) : [],
    offerings: mode.offersRentals ? toPreviewOfferings(offerings) : [],
  };
}
