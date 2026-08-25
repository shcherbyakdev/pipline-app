import type { SectionOf } from "../../schema";

type Photo = SectionOf<"spaces">["photos"][number];

/** The photos list after one edit: the edited offering's entry is replaced
    (or removed when `path` is undefined), and any entry whose offering is no
    longer in the live catalogue is dropped. */
export function photosAfterEdit(
  photos: Photo[],
  liveOfferingIds: readonly string[],
  offeringId: string,
  path: string | undefined,
): Photo[] {
  const kept = photos.filter((p) => p.offeringId !== offeringId && liveOfferingIds.includes(p.offeringId));
  return path ? [...kept, { offeringId, path }] : kept;
}
