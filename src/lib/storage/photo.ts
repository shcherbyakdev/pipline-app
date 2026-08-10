// Pure photo-upload constants and helpers — safe to import from client
// components (the participant flow pre-checks files before any bytes move).
// SVG is deliberately absent: scriptable images never enter the bucket.
export const PHOTO_MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

export const PHOTO_MAX_BYTES = 15 * 1024 * 1024; // mirrors the bucket + RPC caps

export function isAllowedPhotoType(mime: string): boolean {
  return Object.hasOwn(PHOTO_MIME_EXTENSIONS, mime);
}

export function evidencePathFor(
  orgId: string,
  programId: string,
  unitId: string,
  objectId: string,
  mime: string,
): string | null {
  const ext = PHOTO_MIME_EXTENSIONS[mime];
  if (!ext) return null;
  return `${orgId}/${programId}/${unitId}/${objectId}.${ext}`;
}
