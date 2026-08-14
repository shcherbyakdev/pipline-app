import { notFound } from "next/navigation";
import { getBookingOrg, listPublicServices } from "@/lib/booking/public";
import { getOrgBranding } from "@/lib/org-branding";
import { BrandedHeader } from "@/components/branded-header";
import { BookingWidget } from "@/features/scheduling/components/booking-widget";

export default async function BookPage({ params }: PageProps<"/book/[handle]">) {
  const { handle } = await params;
  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(handle)) notFound();
  const org = await getBookingOrg(handle);
  if (!org) notFound();
  const [services, branding] = await Promise.all([
    listPublicServices(org.orgId),
    getOrgBranding(org.orgId),
  ]);
  if (services.length === 0) notFound();
  return (
    <div className="flex flex-col gap-6">
      <BrandedHeader
        orgName={org.orgName}
        accentColor={branding.accentColor}
        logoUrl={branding.logoUrl}
      />
      <BookingWidget handle={handle} orgTimeZone={org.timeZone} services={services} />
    </div>
  );
}
