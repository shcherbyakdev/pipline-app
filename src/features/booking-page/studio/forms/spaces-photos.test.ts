import { describe, it, expect } from "vitest";
import { photosAfterEdit } from "./spaces-photos";

const A = "11111111-2222-4333-8444-555555555555";
const B = "22222222-2222-4333-8444-555555555555";
const C = "33333333-2222-4333-8444-555555555555";
const IMG_A = "abc/page/aaaaaaaaaaaaaaaa.png";
const IMG_A2 = "abc/page/bbbbbbbbbbbbbbbb.png";
const IMG_B = "abc/page/cccccccccccccccc.png";

describe("photosAfterEdit", () => {
  it("replace: setting a new path for an offering keeps every other entry", () => {
    const photos = [{ offeringId: A, path: IMG_A }, { offeringId: B, path: IMG_B }];
    expect(photosAfterEdit(photos, [A, B], A, IMG_A2)).toEqual([{ offeringId: B, path: IMG_B }, { offeringId: A, path: IMG_A2 }]);
  });
  it("remove: an undefined path drops only that offering's entry", () => {
    const photos = [{ offeringId: A, path: IMG_A }, { offeringId: B, path: IMG_B }];
    expect(photosAfterEdit(photos, [A, B], A, undefined)).toEqual([{ offeringId: B, path: IMG_B }]);
  });
  it("orphaned: an entry whose offering left the live catalogue is dropped on an unrelated edit", () => {
    // C's offering no longer exists in the live catalogue; editing A must not
    // keep C's stale entry around.
    const photos = [{ offeringId: A, path: IMG_A }, { offeringId: C, path: IMG_B }];
    expect(photosAfterEdit(photos, [A, B], A, IMG_A2)).toEqual([{ offeringId: A, path: IMG_A2 }]);
  });
});
