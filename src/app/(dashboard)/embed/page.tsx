import { notFound } from "next/navigation";
import { getBrandingSettings, getSchedulingSettings } from "@/features/orgs/queries";
import { WidgetAppearance } from "@/features/orgs/components/widget-appearance";
import { LinksTable } from "@/features/orgs/components/links-table";
import { listServices } from "@/features/scheduling/queries";
import { listStaff } from "@/features/scheduling/staff-queries";
import { listOfferings } from "@/features/rentals/queries";
import { effectiveMode, modeOf } from "@/features/orgs/mode";
import { toPreviewCatalog } from "@/lib/booking/preview-catalog";
import { requireOrg } from "@/lib/auth/session";
import { parseWidgetTheme } from "@/lib/widget-theme";
import { createClient } from "@/lib/supabase/server";
import { getEntitlements } from "@/lib/billing/queries";
import { getDashboardFlags } from "@/lib/flags/resolve";
import { env } from "@/env";
import { PageIntro } from "@/components/shell/page-header";

async function badgeToggleEnabled(orgId: string): Promise<boolean> {
  try {
    // BOTH reads sit inside the try: a flags hiccup on this page fails OPEN
    // exactly like the entitlement read does. getDashboardFlags degrades to
    // FLAG_DEFAULTS on its own now (billing off ⇒ toggle enabled), so this is
    // belt-and-braces — but leaving one of the two reads able to 500 the page
    // while the other cannot is the asymmetry worth removing.
    if (!(await getDashboardFlags(orgId)).billing) return true;
    return (await getEntitlements(orgId, await createClient())).hideBadge;
  } catch (error) {
    console.error("[billing] embed badge-toggle read failed — toggle stays enabled:", error);
    return true;
  }
}

/* Website embed: the second booking channel — the widget on the org's own
   site. Style it against a live preview, then copy the snippet. */
export default async function EmbedPage({ searchParams }: PageProps<"/embed">) {
  // The preview shows the channels the public widget shows (listPublicCatalog's
  // rules): declared mode ∩ the rentals kill switch, same as /bookings.
  const { org } = await requireOrg();
  const mode = effectiveMode(await getDashboardFlags(org.id), modeOf(org));
  const [settings, schedulingSettings, services, staff, offerings] = await Promise.all([
    getBrandingSettings(),
    getSchedulingSettings(),
    listServices(),
    listStaff(),
    mode.offersRentals ? listOfferings() : [],
  ]);
  if (!settings || !schedulingSettings) notFound();

  // Hiding "Powered by Booklo" is a paid perk (spec §5). While billing is off
  // nothing is read and every org keeps the toggle it has today. A failed read
  // fails OPEN (toggle stays usable) rather than 500-ing this page: the same
  // ruling loadPublicOffering follows, and the badge itself is enforced
  // server-side regardless (badgeVisible / emailBadgeUrl).
  const canHideBadge = await badgeToggleEnabled(settings.orgId);

  const catalog = toPreviewCatalog({ mode, services, offerings });
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
        currency={schedulingSettings.currency}
        appUrl={env.NEXT_PUBLIC_APP_URL}
        previewServices={catalog.services}
        previewOfferings={catalog.offerings}
        mode={mode}
        staffOptions={staffOptions}
        initialStaffSlug={initialStaffSlug}
        canHideBadge={canHideBadge}
      />
      {schedulingSettings.handle ? (
        <LinksTable
          appUrl={env.NEXT_PUBLIC_APP_URL}
          handle={schedulingSettings.handle}
          mode={mode}
          staff={staffOptions}
          services={services.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name }))}
          spaces={offerings.filter((o) => o.active).map((o) => ({ id: o.id, name: o.name }))}
        />
      ) : null}
    </div>
  );
}
