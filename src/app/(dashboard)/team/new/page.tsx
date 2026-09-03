import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { listServices } from "@/features/scheduling/queries";
import { listStaff } from "@/features/scheduling/staff-queries";
import { addStaffGateHref } from "@/features/scheduling/staff-gate";
import { StaffForm } from "@/features/scheduling/components/staff-form";
import { requireOrg } from "@/lib/auth/session";

/* A new person, on a page of their own (no dialog on the roster). */
export default async function NewTeamMemberPage() {
  const { org } = await requireOrg();
  const [staff, services, scheduling, gateHref, t] = await Promise.all([
    listStaff(),
    listServices(),
    getSchedulingSettings(),
    addStaffGateHref(org.id),
    getTranslations("team"),
  ]);
  // Same gate as the roster's button: a capped org never sees a form the
  // action would only refuse.
  if (gateHref) redirect(gateHref);
  if (!scheduling) notFound();

  // The new person inherits the first active member's weekly hours (the RPC
  // picks the same row), so name them under the form.
  const firstActive = staff.find((s) => s.active) ?? null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <Link href="/team" className="text-muted-foreground w-fit text-xs hover:underline">
          {t("detail.back")}
        </Link>
        <h1 className="text-lg font-semibold">{t("newButton")}</h1>
      </div>
      <StaffForm
        services={services}
        usedColors={staff.map((s) => s.color)}
        handle={scheduling.handle}
        firstActiveStaffName={firstActive?.name ?? null}
      />
    </div>
  );
}
