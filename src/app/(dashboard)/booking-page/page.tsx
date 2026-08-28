import { notFound } from "next/navigation";
import { getBrandingSettings, getSchedulingSettings } from "@/features/orgs/queries";
import { listServices } from "@/features/scheduling/queries";
import { listStaff } from "@/features/scheduling/staff-queries";
import { listOfferings } from "@/features/rentals/queries";
import { effectiveMode, modeOf, presentMode } from "@/features/orgs/mode";
import { APPOINTMENTS, SPACES } from "@/features/orgs/vocab";
import { isBookableOffering, toPreviewCatalog } from "@/lib/booking/preview-catalog";
import { frontDoor } from "@/lib/booking/channel-pages";
import { requireOrg } from "@/lib/auth/session";
import { getDashboardFlags } from "@/lib/flags/resolve";
import { pageChannelMode, parsePageChannel, type PageChannel } from "@/features/booking-page/channel";
import { EMPTY_PAGE_STATE, getPageStates, getPageSectionsEntitlement } from "@/features/booking-page/queries";
import { BookingPageBuilder } from "@/features/booking-page/studio/booking-page-builder";
import { PageSwitch } from "@/features/booking-page/studio/page-switch";
import { PageIntro } from "@/components/shell/page-header";
import { env } from "@/env";

/* Booking page: the hosted channel — its sections, address, timezone and
   branding, edited against a live preview of the page itself and published
   explicitly. (Branding's accent and theme are shared with the website embed.)
   One page per channel (spec 2026-08-28 §4): `?page=` names it. */
export default async function BookingPagePage({ searchParams }: PageProps<"/booking-page">) {
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

  // Which page: ?page= when it names a channel the org declares; else the
  // front door (what /<handle> shows); else the declared-first channel.
  const requested = parsePageChannel((await searchParams).page);
  const offered = (c: PageChannel) => (c === "appointments" ? declared.offersAppointments : declared.offersRentals);
  const channel: PageChannel =
    requested && offered(requested) ? requested
    : (frontDoor(has) ?? (declared.offersAppointments ? "appointments" : "spaces"));
  // A page IS its channel: the renderer, fitToMode, the add-section palette
  // and the thumbnails all take this single-channel mode. The canned
  // stand-in (preview-catalog) appears only for THIS channel when it has
  // nothing bookable yet — never "Studio A" on an appointments page.
  const mode = pageChannelMode(channel);
  const catalog = toPreviewCatalog({ mode, services, offerings });
  // The preview's link to the other page: present when that channel is
  // declared AND has something bookable — the public page's rule (§3.5).
  const present = presentMode(declared, has);
  const crossLink =
    channel === "appointments" && present.offersRentals && has.spaces ? { href: "#", label: SPACES.crossLink }
    : channel === "spaces" && present.offersAppointments && has.services ? { href: "#", label: APPOINTMENTS.crossLink }
    : null;
  // The live page 404s until the channel has something bookable —
  // resolveChannelPage's rule.
  const publicReachable = channel === "appointments" ? has.services : has.spaces;
  const [pages, pageSections] = await Promise.all([
    getPageStates(branding.orgId),
    getPageSectionsEntitlement(branding.orgId),
  ]);
  const page = pages[channel] ?? EMPTY_PAGE_STATE;
  const switchable = declared.offersAppointments && declared.offersRentals;

  return (
    // Wider than the other settings pages: the preview must be able to show
    // the split layout (≥ 48rem of page column) at desktop.
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 p-6">
      <PageIntro>The page clients book you on. Arrange its sections, brand it, then publish.</PageIntro>
      {switchable ? <PageSwitch value={channel} /> : null}
      <BookingPageBuilder
        // Re-mount per page: the draft hook is seeded once from its props.
        key={channel}
        channel={channel}
        publicReachable={publicReachable}
        crossLink={crossLink}
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
