import { notFound } from "next/navigation";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { listServices } from "@/features/scheduling/queries";
import { listStaff } from "@/features/scheduling/staff-queries";
import { StaffList } from "@/features/scheduling/components/staff-list";
import { StaffDialog } from "@/features/scheduling/components/staff-dialog";
import { PageIntro } from "@/components/shell/page-header";
import { env } from "@/env";

/* Team: the roster. Always visible, even for a solo provider — they see one
   row (themselves) with their booking link, and nothing about the app changes
   until they add a second person. */
export default async function TeamPage() {
  const [staff, services, scheduling] = await Promise.all([
    listStaff(),
    listServices(),
    getSchedulingSettings(),
  ]);
  if (!scheduling) notFound();

  // The new person inherits the first active member's weekly hours (the RPC
  // picks the same row), so name them in the dialog's note.
  const firstActive = staff.find((s) => s.active) ?? null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <PageIntro>
        Your bookable people. Each has their own hours, services and booking link.
      </PageIntro>
      <div className="flex items-center justify-end">
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
      />
    </div>
  );
}
