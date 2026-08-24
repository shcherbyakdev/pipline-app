import { notFound } from "next/navigation";

/* Programs belong to the legacy fire-safety pipeline, parked since the
   2026-08-13 scheduling pivot (hidden, not deleted). Until now nothing took
   the route off the map: any signed-in member could reach every page and
   every write path under it. This layout 404s unconditionally — the pages
   and features below stay intact (overview/layout.tsx precedent). To
   un-park, add a `programs` key to FLAG_DEFAULTS (lib/flags) and gate here
   the way rentals/layout.tsx does. */
export default function ProgramsLayout(): never {
  notFound();
}
