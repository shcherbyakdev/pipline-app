import { notFound } from "next/navigation";
import type { AbstractIntlMessages } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { publicMessages } from "@/i18n/public-provider";
import { LOCALES, type Locale } from "@/i18n/config";
import { listServiceStaffMap } from "@/lib/booking/public";
import { getBrandingSettings, getSchedulingSettings } from "@/features/orgs/queries";
import { WidgetAppearance } from "@/features/orgs/components/widget-appearance";
import { listServices } from "@/features/scheduling/queries";
import { listStaff } from "@/features/scheduling/staff-queries";
import { listOfferings } from "@/features/rentals/queries";
import { bookableAdminServices } from "@/lib/booking/bookable";
import { effectiveMode, modeOf } from "@/features/orgs/mode";
import { initialRowKey, linkRows } from "@/features/orgs/link-rows";
import { toPreviewCatalog } from "@/lib/booking/preview-catalog";
import { requireOrg } from "@/lib/auth/session";
import { parseWidgetTheme } from "@/lib/widget-theme";
import { badgeToggle } from "@/lib/billing/badge-toggle";
import { getDashboardFlags } from "@/lib/flags/resolve";
import { env } from "@/env";

/* Website embed: the second booking channel — the widget on the org's own
   site. Copy the snippet; style it against a live preview if you want to. */
export default async function EmbedPage({ searchParams }: PageProps<"/embed">) {
  // The preview shows the channel the public widget shows (listPublicCatalog's
  // rule): declared mode ∩ the rentals kill switch, same as /bookings.
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
  const { canHideBadge, upgradeHref: badgeUpgradeHref } = await badgeToggle(settings.orgId);

  const catalog = toPreviewCatalog({ mode, services, offerings });
  // The snippet's iframe title is what a CLIENT's screen reader announces on
  // the org's site, so it speaks the org's language (Booking page › Settings
  // › Language), not the admin's — the booking-page preview's rule.
  const tTitle = await getTranslations({ locale: schedulingSettings.locale, namespace: "embedTitle" });
  // The preview speaks whichever language the snippet pins (Code › Language),
  // else the org's — so every public language is loaded, not just the org's.
  // The preview narrows by person the way the public embed does, which
  // needs the roster (public shape: never email) and who offers what.
  const [bundles, serviceStaffIds] = await Promise.all([
    Promise.all(LOCALES.map(async (locale) => [locale, publicMessages(await getMessages({ locale }))] as const)),
    listServiceStaffMap(org.id),
  ]);
  const previewMessages = Object.fromEntries(bundles) as Record<Locale, AbstractIntlMessages>;
  const activeStaff = staff.filter((s) => s.active);
  const publicStaff = activeStaff.map(({ id, name, slug, color }) => ({ id, name, slug, color }));
  const titles = { appointment: tTitle("appointment"), space: tTitle("space") };
  // What the snippet can point at (admin IA spec §5): the page, one person,
  // one service, one space. A solo team lists no people (there is only one
  // answer); the Team, Service and Space pages' Embed links land here with
  // ?staff= / ?service= / ?space= preselected.
  const rows = linkRows({
    mode,
    staff: activeStaff.length > 1 ? activeStaff.map((s) => ({ slug: s.slug, name: s.name })) : [],
    services: bookableAdminServices(services, staff).map((s) => ({ id: s.id, name: s.name })),
    spaces: offerings.filter((o) => o.active).map((o) => ({ id: o.id, name: o.name })),
  });
  const initialKey = initialRowKey(rows, await searchParams);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <WidgetAppearance
        previewMessages={previewMessages}
        orgLocale={schedulingSettings.locale}
        orgTimeZone={schedulingSettings.timezone}
        initial={parseWidgetTheme(settings.widgetTheme)}
        accentColor={settings.accentColor}
        handle={schedulingSettings.handle}
        currency={schedulingSettings.currency}
        appUrl={env.NEXT_PUBLIC_APP_URL}
        previewServices={catalog.services}
        previewOfferings={catalog.offerings}
        staff={publicStaff}
        serviceStaffIds={serviceStaffIds}
        mode={mode}
        titles={titles}
        rows={rows}
        initialKey={initialKey}
        canHideBadge={canHideBadge}
        upgradeHref={badgeUpgradeHref}
      />
    </div>
  );
}
