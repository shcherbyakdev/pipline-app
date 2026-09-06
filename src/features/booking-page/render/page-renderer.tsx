import { cn } from "@/lib/utils";
import type { PageDocument, Section } from "../schema";
import { publicSections } from "../doc-ops";
import type { RenderContext } from "./context";
import { crossLinkHost } from "./cross-link-host";
import { PageStateProvider } from "./page-state";
import { pickersOnPage, type Pickers } from "./pickers";
import { SectionFrame } from "./section-frame";
import { HeaderSection } from "./sections/header";
import { HeroSection } from "./sections/hero";
import { AboutSection } from "./sections/about";
import { ServicesSection } from "./sections/services";
import { StaffSection } from "./sections/staff";
import { SpacesSection } from "./sections/spaces";
import { GallerySection } from "./sections/gallery";
import { TestimonialsSection } from "./sections/testimonials";
import { FaqSection } from "./sections/faq";
import { LinksSection } from "./sections/links";
import { LocationSection } from "./sections/location";
import { BookingSection } from "./sections/booking";

/** Page column width per layout — the public <main> and the studio preview share it. */
export function pageContainerClass(layout: PageDocument["layout"]): string {
  return layout === "split" ? "max-w-5xl" : "max-w-xl";
}

/* The page itself: one floating panel on the shell's soft ground — the
   admin's content panel and the landing's hero card, drawn with the widget
   theme's shapes (2r; `rounded-2xl` only reaches a use outside the widget
   theme, like the manage page — inside it the theme squares and wt-r2 wins)
   and the app's hairline + card shadow. Sections lay out inside it; the
   badge and the language links stay on the ground. */
export const PAGE_PANEL_CLASS = "wt-r2 rounded-2xl bg-background border shadow-(--shadow-card) p-5 sm:p-7";

function renderSection(section: Section, ctx: RenderContext, pickers: Pickers, crossLink: RenderContext["crossLink"], heroCtaHidden: boolean) {
  switch (section.type) {
    case "header": return <HeaderSection section={section} ctx={ctx} crossLink={crossLink} />;
    case "hero": return <HeroSection section={section} ctx={ctx} pickers={pickers} crossLink={crossLink} ctaHidden={heroCtaHidden} />;
    case "about": return <AboutSection section={section} ctx={ctx} />;
    case "services": return <ServicesSection section={section} ctx={ctx} />;
    case "staff": return <StaffSection section={section} ctx={ctx} />;
    case "spaces": return <SpacesSection section={section} ctx={ctx} />;
    case "gallery": return <GallerySection section={section} ctx={ctx} />;
    case "testimonials": return <TestimonialsSection section={section} ctx={ctx} />;
    case "faq": return <FaqSection section={section} ctx={ctx} />;
    case "links": return <LinksSection section={section} ctx={ctx} />;
    case "location": return <LocationSection section={section} ctx={ctx} />;
    case "booking": return <BookingSection section={section} ctx={ctx} pickers={pickers} crossLink={crossLink} />;
  }
}

// Split layout, container-query driven (the page column, not the viewport)
// so the studio preview and its phone toggle behave like the real page. The
// query is 710px of CONTENT box: the container is the panel, whose padding
// and hairline (2 × 29px at sm:) come off the 48rem the layout used to
// split at, so it still flips at the same page width. The booking section
// docks in column 2 and spans every explicit row (gridTemplateRows below);
// the rest auto-place down column 1. Below the query the container is a
// plain flex column in DOM (= array) order.
const DOCKED = "@min-[710px]:col-start-2 @min-[710px]:row-start-1 @min-[710px]:row-end-[-1] @min-[710px]:sticky @min-[710px]:top-6 @min-[710px]:self-start";

/* One renderer for /book/[handle], staff pages, the studio preview and
   template thumbnails. Public mode drops hidden and empty sections; preview
   mode shows everything (hidden ones dimmed) so each can be selected. */
export function PageRenderer({
  doc,
  ctx,
  initialServiceId = null,
  initialOfferingId = null,
}: {
  doc: PageDocument;
  ctx: RenderContext;
  initialServiceId?: string | null;
  initialOfferingId?: string | null;
}) {
  const counts = { serviceCount: ctx.services.length, staffCount: ctx.lockedStaff ? 0 : ctx.staff.length, offeringCount: ctx.offerings.length };
  const sections = ctx.mode === "public" ? publicSections(doc, counts) : doc.sections;
  // Which catalogue sections the PUBLIC page shows (even in preview, which
  // renders hidden ones dimmed): those are the pickers, the widget defers.
  const pickers = pickersOnPage(doc, counts);
  const shownPublic = publicSections(doc, counts);
  // The sibling-channel link's host, decided on the public-visible list so
  // preview and live agree (same doctrine as pickers). One section gets it.
  const host = ctx.crossLink ? crossLinkHost(shownPublic) : null;
  // The cover's Book button points at the page's first booking step
  // (bookHref). When that target renders ABOVE the hero — a page that leads
  // with its catalogue — the button would scroll backwards and read as dead,
  // so it is suppressed. Decided on the public-visible order (same doctrine
  // as pickers) so the studio preview and the live page agree.
  const ctaTarget = pickers.services ? "services" : pickers.spaces ? "spaces" : "booking";
  const heroIdx = shownPublic.findIndex((s) => s.type === "hero");
  const targetIdx = shownPublic.findIndex((s) => s.type === ctaTarget);
  const heroCtaHidden = heroIdx !== -1 && targetIdx !== -1 && targetIdx < heroIdx;
  const split = doc.layout === "split";
  const others = sections.filter((s) => s.type !== "booking").length;
  return (
    <PageStateProvider initialServiceId={initialServiceId} initialOfferingId={initialOfferingId}>
      {/* Container queries resolve against an ancestor, never the element
          that declares containment — so the @container lives on this plain
          wrapper and the @3xl: variants on the layout div inside it. */}
      <div className={cn("@container w-full", PAGE_PANEL_CLASS)}>
        <div
          className={cn("flex w-full flex-col gap-8", split && "@min-[710px]:grid @min-[710px]:grid-cols-[minmax(0,1fr)_minmax(0,400px)] @min-[710px]:gap-x-10")}
          style={split ? { gridTemplateRows: `repeat(${Math.max(others, 1)}, auto)` } : undefined}
        >
          {sections.map((section) => {
            const docked = split && section.type === "booking";
            const inner = renderSection(section, ctx, pickers, host?.sectionId === section.id ? ctx.crossLink : null, heroCtaHidden);
            return ctx.mode === "preview" ? (
              <SectionFrame key={section.id} id={section.id} type={section.type} hidden={section.hidden} chrome={ctx.preview! /* every preview ctx carries its chrome (booking-page-builder.tsx) */} className={cn(docked && DOCKED)}>
                {inner}
              </SectionFrame>
            ) : (
              <div key={section.id} className={cn(docked && DOCKED)}>{inner}</div>
            );
          })}
        </div>
      </div>
    </PageStateProvider>
  );
}
