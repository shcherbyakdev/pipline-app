import { notFound } from "next/navigation";

/* Templates belong to the legacy fire-safety pipeline, parked since the
   2026-08-13 scheduling pivot (hidden, not deleted). Same treatment as
   programs/layout.tsx: an unconditional 404 that leaves the pages and
   features below intact. To un-park, add a `templates` (or shared
   `programs`) key to FLAG_DEFAULTS (lib/flags) and gate here the way
   rentals/layout.tsx does. */
export default function TemplatesLayout(): never {
  notFound();
}
