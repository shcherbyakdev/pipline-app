import type { PublicService } from "@/lib/booking/public";

// Canned data for the admin's live previews (Booking page, Website embed):
// six slots across two far-future days so nothing ever needs refreshing,
// and a stand-in service used only when the org has no active service yet,
// so appearance can still be judged before the first one exists.
export const PREVIEW_SLOTS = [
  "2030-01-07T09:00:00.000Z",
  "2030-01-07T10:00:00.000Z",
  "2030-01-07T11:00:00.000Z",
  "2030-01-08T09:00:00.000Z",
  "2030-01-08T10:00:00.000Z",
  "2030-01-08T11:00:00.000Z",
];

const CANNED_PREVIEW_SERVICE: PublicService = {
  id: "preview-service",
  name: "Consultation",
  description: null,
  durationMin: 30,
  priceLabel: null,
  bufferBeforeMin: 0,
  bufferAfterMin: 0,
  minNoticeMin: 0,
  maxPerDay: null,
  bookingWindowDays: 30,
};

type ServiceRow = PublicService & { active: boolean };

/** Active services as the public widget sees them; the canned one if none. */
export function toPreviewServices(services: ServiceRow[]): PublicService[] {
  const active: PublicService[] = services
    .filter((s) => s.active)
    .map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      durationMin: s.durationMin,
      priceLabel: s.priceLabel,
      bufferBeforeMin: s.bufferBeforeMin,
      bufferAfterMin: s.bufferAfterMin,
      minNoticeMin: s.minNoticeMin,
      maxPerDay: s.maxPerDay,
      bookingWindowDays: s.bookingWindowDays,
    }));
  return active.length > 0 ? active : [CANNED_PREVIEW_SERVICE];
}
