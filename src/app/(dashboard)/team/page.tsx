import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { listStaff } from "@/features/scheduling/staff-queries";
import { addStaffGateHref } from "@/features/scheduling/staff-gate";
import { StaffList } from "@/features/scheduling/components/staff-list";
import { PageIntro } from "@/components/shell/page-header";
import { buttonVariants } from "@/components/ui/button";
import { loadPublicResources } from "@/lib/booking/public-offering";
import { requireOrg } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

/* Team: the roster. Always visible, even for a solo provider — they see one
   row (themselves) with their booking link, and nothing about the app changes
   until they add a second person. Each row opens the person's own page. */
export default async function TeamPage() {
  const { org } = await requireOrg();
  const [staff, scheduling, resources, gateHref] = await Promise.all([
    listStaff(),
    getSchedulingSettings(),
    // The plan's ACTUAL public roster (the same memoised loader the booking
    // page uses), so this page never offers a link that would 404. null = no
    // cap applies (billing off, or the read failed open) → flag nobody.
    loadPublicResources(org.id),
    addStaffGateHref(org.id),
  ]);
  if (!scheduling) notFound();
  const t = await getTranslations("team");
  const publicStaffIds = resources ? resources.staff.map((s) => s.id) : null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <PageIntro>{t("intro")}</PageIntro>
        {/* A capped org gets the door, not a form the action would refuse. */}
        <Link href={gateHref ?? "/team/new"} className={cn(buttonVariants({ size: "sm" }), "w-fit")}>
          <Plus className="size-4" /> {t("newButton")}
        </Link>
      </div>
      <StaffList staff={staff} handle={scheduling.handle} publicStaffIds={publicStaffIds} />
    </div>
  );
}
