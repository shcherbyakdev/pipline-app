import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getBrandingSettings, getSchedulingSettings } from "@/features/orgs/queries";
import { WidgetAppearance } from "@/features/orgs/components/widget-appearance";
import { LinksTable } from "@/features/orgs/components/links-table";
import { listServices } from "@/features/scheduling/queries";
import { listStaff } from "@/features/scheduling/staff-queries";
import { listOfferings } from "@/features/rentals/queries";
import { bookableAdminServices } from "@/lib/booking/bookable";
import { effectiveMode, modeOf, presentMode } from "@/features/orgs/mode";
import { isBookableOffering, toPreviewCatalog } from "@/lib/booking/preview-catalog";
import { requireOrg } from "@/lib/auth/session";
import { parseWidgetTheme } from "@/lib/widget-theme";
import { badgeToggle } from "@/lib/billing/badge-toggle";
import { getDashboardFlags } from "@/lib/flags/resolve";
import { env } from "@/env";
import { PageIntro } from "@/components/shell/page-header";

/* Website embed: the second booking channel — the widget on the org's own
   site. Style it against a live preview, then copy the snippet. */
export default async function EmbedPage({ searchParams }: PageProps<"/embed">) {
  // The preview shows the channels the public widget shows (listPublicCatalog's
  // rules): declared mode ∩ the rentals kill switch, same as /bookings — then
  // narrowed to the channels with something bookable (presentMode), as the
  // Booking page does, so the two previews and the live widget agree.
  const { org } = await requireOrg();
  const declared = effectiveMode(await getDashboardFlags(org.id), modeOf(org));
  const [settings, schedulingSettings, services, staff, offerings] = await Promise.all([
    getBrandingSettings(),
    getSchedulingSettings(),
    listServices(),
    listStaff(),
    declared.offersRentals ? listOfferings() : [],
  ]);
  if (!settings || !schedulingSettings) notFound();
  const mode = presentMode(declared, {
    services: services.some((s) => s.active),
    spaces: offerings.some(isBookableOffering),
  });

  // Hiding "Powered by Booklo" is a paid perk (spec §5). While billing is off
  // nothing is read and every org keeps the toggle it has today. A failed read
  // fails OPEN (toggle stays usable) rather than 500-ing this page: the same
  // ruling loadPublicOffering follows, and the badge itself is enforced
  // server-side regardless (badgeVisible / emailBadgeUrl).
  const { canHideBadge, upgradeHref: badgeUpgradeHref } = await badgeToggle(settings.orgId);

  const catalog = toPreviewCatalog({ mode, services, offerings });
  // The snippet's iframe title is what a CLIENT's screen reader announces on
  // the org's site, so it speaks the org's language (Booking page › Settings
  // › Language), not the admin's — the booking-page preview's rule.
  const t = await getTranslations("embed");
  const tTitle = await getTranslations({ locale: schedulingSettings.locale, namespace: "public.embedTitle" });
  const titles = { appointment: tTitle("appointment"), space: tTitle("space") };
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
      <PageIntro>{t("intro")}</PageIntro>
      <WidgetAppearance
        initial={parseWidgetTheme(settings.widgetTheme)}
        accentColor={settings.accentColor}
        handle={schedulingSettings.handle}
        currency={schedulingSettings.currency}
        appUrl={env.NEXT_PUBLIC_APP_URL}
        previewServices={catalog.services}
        previewOfferings={catalog.offerings}
        mode={mode}
        titles={titles}
        staffOptions={staffOptions}
        initialStaffSlug={initialStaffSlug}
        canHideBadge={canHideBadge}
        upgradeHref={badgeUpgradeHref}
      />
      {schedulingSettings.handle ? (
        <LinksTable
          appUrl={env.NEXT_PUBLIC_APP_URL}
          handle={schedulingSettings.handle}
          mode={mode}
          staff={staffOptions}
          services={bookableAdminServices(services, staff).map((s) => ({ id: s.id, name: s.name }))}
          spaces={offerings.filter((o) => o.active).map((o) => ({ id: o.id, name: o.name }))}
          titles={titles}
        />
      ) : null}
    </div>
  );
}
