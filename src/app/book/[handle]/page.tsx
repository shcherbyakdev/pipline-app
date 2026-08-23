import { notFound, permanentRedirect } from "next/navigation";
import { HANDLE_RE } from "@/features/scheduling/handle";
import { bookingPath } from "@/lib/booking/url";

// Legacy address. The page moved to /<handle> (0047); links in old
// confirmation emails and embeds keep resolving through this 308.
export default async function LegacyBookPage({ params }: PageProps<"/book/[handle]">) {
  const { handle } = await params;
  if (!HANDLE_RE.test(handle)) notFound();
  permanentRedirect(bookingPath(handle));
}
