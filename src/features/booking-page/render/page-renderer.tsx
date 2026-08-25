import { cn } from "@/lib/utils";
import type { PageDocument, Section } from "../schema";
import { publicSections } from "../doc-ops";
import type { RenderContext } from "./context";
import { PageStateProvider } from "./page-state";
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

function renderSection(section: Section, ctx: RenderContext) {
  switch (section.type) {
    case "header": return <HeaderSection section={section} ctx={ctx} />;
    case "hero": return <HeroSection section={section} ctx={ctx} />;
    case "about": return <AboutSection section={section} ctx={ctx} />;
    case "services": return <ServicesSection section={section} ctx={ctx} />;
    case "staff": return <StaffSection section={section} ctx={ctx} />;
    case "spaces": return <SpacesSection section={section} ctx={ctx} />;
    case "gallery": return <GallerySection section={section} ctx={ctx} />;
    case "testimonials": return <TestimonialsSection section={section} ctx={ctx} />;
    case "faq": return <FaqSection section={section} ctx={ctx} />;
    case "links": return <LinksSection section={section} ctx={ctx} />;
    case "location": return <LocationSection section={section} ctx={ctx} />;
    case "booking": return <BookingSection section={section} ctx={ctx} />;
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
  const sections =
    ctx.mode === "public"
      ? publicSections(doc, { serviceCount: ctx.services.length, staffCount: ctx.lockedStaff ? 0 : ctx.staff.length, offeringCount: ctx.offerings.length })
      : doc.sections;
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
            const inner = renderSection(section, ctx);
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
