import { notFound, permanentRedirect } from "next/navigation";
import { HANDLE_RE } from "@/features/scheduling/handle";
import { STAFF_SLUG_RE } from "@/features/scheduling/staff-slug";
import { bookingPath } from "@/lib/booking/url";

export default async function LegacyStaffBookPage({ params }: PageProps<"/book/[handle]/[staffSlug]">) {
  const { handle, staffSlug } = await params;
  if (!HANDLE_RE.test(handle) || !STAFF_SLUG_RE.test(staffSlug)) notFound();
  permanentRedirect(bookingPath(handle, staffSlug));
}
