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
  return layout === "split" ? "max-w-5xl" : "max-w-lg";
}

function renderSection(section: Section, ctx: RenderContext, pickers: Pickers, crossLink: RenderContext["crossLink"]) {
  switch (section.type) {
    case "header": return <HeaderSection section={section} ctx={ctx} crossLink={crossLink} />;
    case "hero": return <HeroSection section={section} ctx={ctx} pickers={pickers} crossLink={crossLink} />;
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

// Split layout, container-query driven (@3xl = 48rem of the page column, not
// the viewport) so the studio preview and its phone toggle behave like the
// real page. The booking section docks in column 2 and spans every explicit
// row (gridTemplateRows below); the rest auto-place down column 1. Below
// @3xl the container is a plain flex column in DOM (= array) order.
const DOCKED = "@3xl:col-start-2 @3xl:row-start-1 @3xl:row-end-[-1] @3xl:sticky @3xl:top-6 @3xl:self-start";

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
  // The sibling-channel link's host, decided on the public-visible list so
  // preview and live agree (same doctrine as pickers). One section gets it.
  const host = ctx.crossLink ? crossLinkHost(publicSections(doc, counts)) : null;
  const split = doc.layout === "split";
  const others = sections.filter((s) => s.type !== "booking").length;
  return (
    <PageStateProvider initialServiceId={initialServiceId} initialOfferingId={initialOfferingId}>
      {/* Container queries resolve against an ancestor, never the element
          that declares containment — so the @container lives on this plain
          wrapper and the @3xl: variants on the layout div inside it. */}
      <div className="@container w-full">
        <div
          className={cn("flex w-full flex-col gap-8", split && "@3xl:grid @3xl:grid-cols-[minmax(0,1fr)_minmax(0,400px)] @3xl:gap-x-10")}
          style={split ? { gridTemplateRows: `repeat(${Math.max(others, 1)}, auto)` } : undefined}
        >
          {sections.map((section) => {
            const docked = split && section.type === "booking";
            const inner = renderSection(section, ctx, pickers, host?.sectionId === section.id ? ctx.crossLink : null);
            return ctx.mode === "preview" ? (
              <SectionFrame key={section.id} id={section.id} type={section.type} hidden={section.hidden} className={cn(docked && DOCKED)}>
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
