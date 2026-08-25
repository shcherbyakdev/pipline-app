// Pure helpers for booking-page images — safe to import from client code
// (the studio's upload control and the preview resolve URLs with these).
// Storage I/O (server-only) lives in actions.ts via lib/storage/branding.
// Same split as lib/storage/logo.ts vs branding.ts.
import type { PageDocument, Section } from "./schema";

// 4 MiB, not 5: the upload relays through a server action, and Vercel caps a
// function's request body at 4.5 MB — a 5 MB file would fail with an opaque
// 413 before the action ever ran. The bucket's own limit matches (migration).
export const PAGE_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
// Per-org ceiling on objects under `{orgId}/page/` — the bucket is public and
// orphans are only swept on publish/discard, so an upload loop must not be
// able to fill it without bound.
export const PAGE_IMAGE_MAX_OBJECTS = 200;
export const PAGE_IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const PAGE_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";

export function isAllowedPageImageType(mime: string): boolean {
  return Object.hasOwn(PAGE_IMAGE_MIME_EXTENSIONS, mime);
}

/** `{orgId}/page/{sha256:16}.{ext}` — the `{orgId}/` prefix is the same
    discipline logoPathFor uses, so one bucket rule covers both. */
export const PAGE_IMAGE_PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/page\/[0-9a-f]{16}\.(?:jpg|png|webp)$/;

export function pageImagePrefix(orgId: string): string {
  return `${orgId}/page/`;
}

export function pageImagePathFor(orgId: string, checksum: string, mime: string): string | null {
  const ext = PAGE_IMAGE_MIME_EXTENSIONS[mime];
  if (!ext) return null;
  return `${pageImagePrefix(orgId)}${checksum.slice(0, 16)}.${ext}`;
}

/** Public URL of an object in the branding bucket. Mirrors
    storage.getPublicUrl so the client-side preview needs no Supabase client. */
export function pageImageUrl(supabaseUrl: string, path: string): string {
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/branding/${path}`;
}

export function sectionImagePaths(section: Section): string[] {
  switch (section.type) {
    case "hero":
      return section.imagePath ? [section.imagePath] : [];
    case "about":
      return section.photoPath ? [section.photoPath] : [];
    case "gallery":
      return section.images.map((i) => i.path);
    case "spaces":
      return section.photos.map((p) => p.path);
    default:
      return [];
  }
}

export function imagePathsIn(doc: Pick<PageDocument, "sections">): string[] {
  return doc.sections.flatMap(sectionImagePaths);
}

/** Objects under the org's page prefix that no document references any more. */
export function orphanPaths(listed: readonly string[], referenced: readonly string[]): string[] {
  const keep = new Set(referenced);
  return listed.filter((p) => !keep.has(p));
}
