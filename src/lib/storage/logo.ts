// Pure logo-upload constants and helpers — safe to import from client
// components (branding-form.tsx pre-checks files before any bytes move).
// Split from branding.ts (which carries the `server-only` admin-client I/O)
// for the same reason photo.ts sits beside evidence.ts: a client component
// importing a `server-only`-tainted module fails the build outright, so the
// pure/testable surface has to live in its own module. SVG is deliberately
// absent: a scriptable format has no place in this allowlist. Note that
// isAllowedLogoType only checks the *declared* MIME — a relabeled file (e.g.
// SVG bytes sent as image/png) passes it fine. matchesLogoMagicBytes below
// is what actually keeps a mislabeled file out of the bucket, by sniffing
// the buffered bytes against the declared MIME before upload (actions.ts's
// uploadLogo). That matters more here than on the evidence path: `branding`
// is a public, directly-navigable bucket, unlike the signed-URL `evidence`
// bucket.
export const LOGO_MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const LOGO_MAX_BYTES = 1_048_576; // app-level cap for logos; the bucket itself allows 4 MiB for page images (0049, lowered in 0052)

export function isAllowedLogoType(mime: string): boolean {
  return Object.hasOwn(LOGO_MIME_EXTENSIONS, mime);
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46]; // "RIFF", WebP container
const WEBP_MAGIC = [0x57, 0x45, 0x42, 0x50]; // "WEBP", at offset 8

function bytesStartWith(bytes: Uint8Array, magic: number[], offset = 0): boolean {
  if (bytes.length < offset + magic.length) return false;
  return magic.every((byte, i) => bytes[offset + i] === byte);
}

// Sniffs the buffered bytes against the MIME the caller *declared*, so a
// relabeled file (SVG bytes sent as image/png) is rejected even though it
// passes isAllowedLogoType. Must agree with the declared MIME, not merely
// match one of the three allowed formats.
export function matchesLogoMagicBytes(bytes: Uint8Array, mime: string): boolean {
  switch (mime) {
    case "image/png":
      return bytesStartWith(bytes, PNG_MAGIC);
    case "image/jpeg":
      return bytesStartWith(bytes, JPEG_MAGIC);
    case "image/webp":
      return bytesStartWith(bytes, RIFF_MAGIC) && bytesStartWith(bytes, WEBP_MAGIC, 8);
    default:
      return false;
  }
}

// Content-hashed name: replacement busts caches for free; the org_id prefix
// is what update_org_branding's prefix check pins.
export function logoPathFor(orgId: string, checksum: string, mime: string): string | null {
  const ext = LOGO_MIME_EXTENSIONS[mime];
  if (!ext) return null;
  return `${orgId}/logo-${checksum}.${ext}`;
}
