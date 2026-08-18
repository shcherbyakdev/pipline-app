import { notFound } from "next/navigation";
import { getBrandingSettings, getSchedulingSettings } from "@/features/orgs/queries";
import { WidgetAppearance } from "@/features/orgs/components/widget-appearance";
import { listServices } from "@/features/scheduling/queries";
import { listStaff } from "@/features/scheduling/staff-queries";
import { toPreviewServices } from "@/features/scheduling/preview-services";
import { parseWidgetTheme } from "@/lib/widget-theme";
import { createClient } from "@/lib/supabase/server";
import { getEntitlements } from "@/lib/billing/queries";
import { BILLING_ENABLED } from "@/lib/flags";
import { env } from "@/env";
import { PageIntro } from "@/components/shell/page-header";

async function badgeToggleEnabled(orgId: string): Promise<boolean> {
  if (!BILLING_ENABLED) return true;
  try {
    return (await getEntitlements(orgId, await createClient())).hideBadge;
  } catch (error) {
    console.error("[billing] entitlements read failed — toggle stays enabled:", error);
    return true;
  }
}

/* Website embed: the second booking channel — the widget on the org's own
   site. Style it against a live preview, then copy the snippet. */
export default async function EmbedPage({ searchParams }: PageProps<"/embed">) {
  const [settings, schedulingSettings, services, staff] = await Promise.all([
    getBrandingSettings(),
    getSchedulingSettings(),
    listServices(),
    listStaff(),
  ]);
  if (!settings || !schedulingSettings) notFound();

  // Hiding "Powered by Booklo" is a paid perk (spec §5). While billing is off
  // nothing is read and every org keeps the toggle it has today. A failed read
  // fails OPEN (toggle stays usable) rather than 500-ing this page: the same
  // ruling loadPublicOffering follows, and the badge itself is enforced
  // server-side regardless (badgeVisible / emailBadgeUrl).
  const canHideBadge = await badgeToggleEnabled(settings.orgId);

  const previewServices = toPreviewServices(services);
  // Solo orgs get no "Book with" choice at all (there is only one answer);
  // the Team page's "Embed…" link lands here with ?staff=<slug> preselected.
  const activeStaff = staff.filter((s) => s.active);
  const staffOptions =
    activeStaff.length > 1 ? activeStaff.map((s) => ({ slug: s.slug, name: s.name })) : [];
  const staffParam = (await searchParams).staff;
  const initialStaffSlug =
    typeof staffParam === "string" && staffOptions.some((s) => s.slug === staffParam)
      ? staffParam
      : null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <PageIntro>
        Add booking to your own site. Style the widget against the live preview, then paste the snippet
        into your page. Logo and accent colour come from Booking page › Branding.
      </PageIntro>
      <WidgetAppearance
        initial={parseWidgetTheme(settings.widgetTheme)}
        accentColor={settings.accentColor}
        handle={schedulingSettings.handle}
        appUrl={env.NEXT_PUBLIC_APP_URL}
        previewServices={previewServices}
        staffOptions={staffOptions}
        initialStaffSlug={initialStaffSlug}
        canHideBadge={canHideBadge}
      />
    </div>
  );
}
