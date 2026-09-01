import { notFound } from "next/navigation";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { listServices } from "@/features/scheduling/queries";
import { listStaff } from "@/features/scheduling/staff-queries";
import { StaffList } from "@/features/scheduling/components/staff-list";
import { StaffDialog } from "@/features/scheduling/components/staff-dialog";
import { PageIntro } from "@/components/shell/page-header";
import { loadPublicResources } from "@/lib/booking/public-offering";
import { requireOrg } from "@/lib/auth/session";
import { env } from "@/env";

/* Team: the roster. Always visible, even for a solo provider — they see one
   row (themselves) with their booking link, and nothing about the app changes
   until they add a second person. */
export default async function TeamPage() {
  const { org } = await requireOrg();
  const [staff, services, scheduling, resources] = await Promise.all([
    listStaff(),
    listServices(),
    getSchedulingSettings(),
    // The plan's ACTUAL public roster (the same memoised loader the booking
    // page uses), so this page never offers a link that would 404. null = no
    // cap applies (billing off, or the read failed open) → flag nobody.
    loadPublicResources(org.id),
  ]);
  if (!scheduling) notFound();
  const publicStaffIds = resources ? resources.staff.map((s) => s.id) : null;

  // The new person inherits the first active member's weekly hours (the RPC
  // picks the same row), so name them in the dialog's note.
  const firstActive = staff.find((s) => s.active) ?? null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <PageIntro>
          Your bookable people. Each has their own hours, services and booking link.
        </PageIntro>
        <StaffDialog
          services={services}
          usedColors={staff.map((s) => s.color)}
          handle={scheduling.handle}
          firstActiveStaffName={firstActive?.name ?? null}
        />
      </div>
      <StaffList
        staff={staff}
        services={services}
        handle={scheduling.handle}
        appUrl={env.NEXT_PUBLIC_APP_URL}
        publicStaffIds={publicStaffIds}
      />
    </div>
  );
}
