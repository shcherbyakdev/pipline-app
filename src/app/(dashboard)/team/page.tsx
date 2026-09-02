import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { listServices } from "@/features/scheduling/queries";
import { listStaff } from "@/features/scheduling/staff-queries";
import { StaffList } from "@/features/scheduling/components/staff-list";
import { StaffDialog } from "@/features/scheduling/components/staff-dialog";
import { PageIntro } from "@/components/shell/page-header";
import { loadPublicResources } from "@/lib/booking/public-offering";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { plansEnforced } from "@/lib/flags";
import { getDashboardFlags } from "@/lib/flags/resolve";
import { evaluateResourceGate } from "@/lib/billing/gates";
import { hrefForHint } from "@/lib/billing/upgrade-path";
import { env } from "@/env";

/** Would the plan refuse one more person right now? The page asks the SAME
    gate createStaff does, so the add button never opens a form the action
    would only refuse — it links to the door instead (null = open the form). */
async function addGateHref(orgId: string): Promise<string | null> {
  const flags = await getDashboardFlags(orgId);
  if (!plansEnforced(flags)) return null;
  const refused = await evaluateResourceGate(orgId, await createClient(), flags);
  return refused ? hrefForHint(refused.how) : null;
}

/* Team: the roster. Always visible, even for a solo provider — they see one
   row (themselves) with their booking link, and nothing about the app changes
   until they add a second person. */
export default async function TeamPage() {
  const { org } = await requireOrg();
  const [staff, services, scheduling, resources, gateHref] = await Promise.all([
    listStaff(),
    listServices(),
    getSchedulingSettings(),
    // The plan's ACTUAL public roster (the same memoised loader the booking
    // page uses), so this page never offers a link that would 404. null = no
    // cap applies (billing off, or the read failed open) → flag nobody.
    loadPublicResources(org.id),
    addGateHref(org.id),
  ]);
  if (!scheduling) notFound();
  const t = await getTranslations("team");
  const publicStaffIds = resources ? resources.staff.map((s) => s.id) : null;

  // The new person inherits the first active member's weekly hours (the RPC
  // picks the same row), so name them in the dialog's note.
  const firstActive = staff.find((s) => s.active) ?? null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <PageIntro>{t("intro")}</PageIntro>
        <StaffDialog
          services={services}
          usedColors={staff.map((s) => s.color)}
          handle={scheduling.handle}
          firstActiveStaffName={firstActive?.name ?? null}
          gateHref={gateHref}
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
