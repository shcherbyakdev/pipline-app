// Pure logo-upload constants and helpers — safe to import from client
// components (branding-form.tsx pre-checks files before any bytes move).
// Split from branding.ts (which carries the `server-only` admin-client I/O)
// for the same reason photo.ts sits beside evidence.ts: a client component
// importing a `server-only`-tainted module fails the build outright, so the
// pure/testable surface has to live in its own module. SVG is deliberately
// absent: a scriptable format on a directly-navigable public URL never
// enters the bucket (spec decision).
export const LOGO_MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const LOGO_MAX_BYTES = 1_048_576; // mirrors the bucket cap

export function isAllowedLogoType(mime: string): boolean {
  return Object.hasOwn(LOGO_MIME_EXTENSIONS, mime);
}

// Content-hashed name: replacement busts caches for free; the org_id prefix
// is what update_org_branding's prefix check pins.
export function logoPathFor(orgId: string, checksum: string, mime: string): string | null {
  const ext = LOGO_MIME_EXTENSIONS[mime];
  if (!ext) return null;
  return `${orgId}/logo-${checksum}.${ext}`;
}
