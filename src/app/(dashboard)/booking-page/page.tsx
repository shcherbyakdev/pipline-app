import { notFound } from "next/navigation";
import { getBrandingSettings, getSchedulingSettings } from "@/features/orgs/queries";
import { listServices } from "@/features/scheduling/queries";
import { listStaff } from "@/features/scheduling/staff-queries";
import { listOfferings } from "@/features/rentals/queries";
import { effectiveMode, modeOf } from "@/features/orgs/mode";
import { getMessages, getTranslations } from "next-intl/server";
import { publicMessages } from "@/i18n/public-provider";
import { isBookableOffering, toPreviewCatalog } from "@/lib/booking/preview-catalog";
import { channelReach } from "@/lib/booking/channel-pages";
import { loadPublicResources } from "@/lib/booking/public-offering";
import { upgradeHref } from "@/lib/billing/upgrade-path";
import { getPlanStatus } from "@/features/billing/queries";
import { requireOrg } from "@/lib/auth/session";
import { getDashboardFlags } from "@/lib/flags/resolve";
import { pageChannelMode, type PageChannel } from "@/features/booking-page/channel";
import { EMPTY_PAGE_STATE, getPageStates, getPageSectionsEntitlement } from "@/features/booking-page/queries";
import { isFreshPage } from "@/features/booking-page/studio/starter-state";
import { parseWidgetTheme } from "@/lib/widget-theme";
import { badgeToggle } from "@/lib/billing/badge-toggle";
import { BookingPageBuilder } from "@/features/booking-page/studio/booking-page-builder";
import { PageIntro } from "@/components/shell/page-header";
import { env } from "@/env";

/* Booking page: the hosted channel — its sections, address, timezone and
   branding, edited against a live preview of the page itself and published
   explicitly. (Branding's accent and theme are shared with the website embed.)
   One page per org: the org's one channel (0073). */
export default async function BookingPagePage() {
  const { org } = await requireOrg();
  const declared = effectiveMode(await getDashboardFlags(org.id), modeOf(org));
  const [branding, scheduling, services, staff, offerings] = await Promise.all([
    getBrandingSettings(),
    getSchedulingSettings(),
    listServices(),
    listStaff(),
    declared.offersRentals ? listOfferings() : [],
  ]);
  if (!branding || !scheduling) notFound();
  // Admin-side approximation of catalogueHas (lib/booking/catalog.ts): the
  // public catalogue also drops staffless and plan-hidden services, so the
  // two can differ for an org whose every person is deactivated.
  const has = { services: services.some((s) => s.active), spaces: offerings.some(isBookableOffering) };

  // The page IS the org's channel: the renderer, fitToMode, the add-section
  // palette and the thumbnails all take this single-channel mode. The canned
  // stand-in (preview-catalog) appears only when the channel has nothing
  // bookable yet.
  const channel: PageChannel = declared.offersAppointments ? "appointments" : "spaces";
  const mode = pageChannelMode(channel);
  const catalog = toPreviewCatalog({ mode, services, offerings });
  // The preview shows what a CLIENT sees, so it speaks the org's language
  // (Booking page › Settings › Language), not the admin's — the whole
  // preview subtree via previewIntl below.
  const previewIntl = { locale: scheduling.locale, messages: publicMessages(await getMessages({ locale: scheduling.locale })) };
  const tSeed = await getTranslations({ locale: scheduling.locale, namespace: "seed" });
  const seed = { bookNow: tSeed("bookNow"), services: tSeed("services"), team: tSeed("team"), spaces: tSeed("spaces") };
  // The live page 404s until the channel has something bookable —
  // frontDoor's rule.
  // The plan's ACTUAL public view (the same memoised loader the public page
  // uses; null = no cap applies): a Free org past its resource budget has
  // spaces the public page never lists, and the studio must say so rather
  // than offer a "View live page" that lands on a 404.
  const resources = await loadPublicResources(org.id);
  const publicHas = resources
    ? {
        services: has.services && resources.staff.length > 0,
        spaces: offerings.some((o) => isBookableOffering(o) && resources.allowedSpaceIds.has(o.id)),
      }
    : null;
  const reach = channelReach(channel, has, publicHas);
  const publicReachable = reach.reachable;
  const capped = reach.capped
    ? { href: upgradeHref(await getDashboardFlags(org.id), (await getPlanStatus()).plan) }
    : null;
  const [pages, pageSections] = await Promise.all([
    getPageStates(branding.orgId),
    getPageSectionsEntitlement(branding.orgId),
  ]);
  const page = pages[channel] ?? EMPTY_PAGE_STATE;
  // The starter (widget templates spec §5): a fresh appointments page —
  // nothing published, the default composition, no widget layout chosen
  // yet — opens it on the layout step; a fresh spaces page has no layout to
  // pick and opens it only to ask for the first space.
  const theme = parseWidgetTheme(branding.pageTheme);
  const badge = await badgeToggle(branding.orgId);
  const bookable = offerings.filter(isBookableOffering);
  const hasHourly = bookable.some((o) => o.rangeMode === "hours");
  const hasStays = bookable.some((o) => o.rangeMode !== "hours");
  // Every group this page asks about answered: times for appointments (and
  // hourly spaces), stays for nights/days (spec §8).
  const layoutChosen =
    channel === "appointments" ? theme.layout !== undefined : (!hasHourly || theme.layout !== undefined) && (!hasStays || theme.stayLayout !== undefined);
  const needsFirstItem = channel === "appointments" ? !has.services : !has.spaces;
  const starter = {
    // Nothing bookable yet: the starter opens for the first item regardless.
    fresh: isFreshPage(page, needsFirstItem ? false : layoutChosen),
    needsFirstItem,
  };
  const t = await getTranslations("studio");

  return (
    // Wider than the other settings pages: the preview must be able to show
    // the split layout (≥ 48rem of page column) at desktop.
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 p-6">
      <PageIntro>{t("intro")}</PageIntro>
      <BookingPageBuilder
        // Re-mount per page: the draft hook is seeded once from its props.
        key={channel}
        channel={channel}
        publicReachable={publicReachable}
        capped={capped}
        starter={starter}
        badge={badge}
        previewIntl={previewIntl}
        seed={seed}
        branding={branding}
        scheduling={scheduling}
        appUrl={env.NEXT_PUBLIC_APP_URL}
        supabaseUrl={env.NEXT_PUBLIC_SUPABASE_URL}
        previewServices={catalog.services}
        previewOfferings={catalog.offerings}
        // The preview's Team section shows the real active roster (public shape: never email).
        staff={staff.filter((s) => s.active).map(({ id, name, slug, color }) => ({ id, name, slug, color }))}
        initialPage={{ draft: page.draft, published: page.published }}
        pageSections={pageSections}
        mode={mode}
      />
    </div>
  );
}
