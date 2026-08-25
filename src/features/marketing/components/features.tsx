import { anchorId, FEATURES, SECTIONS, SITE } from "@/features/marketing/site";
import { SectionHeader } from "./section-header";
import { FeatureMock } from "./mocks/feature-mocks";

/* Feature panels: a sand panel holds a real fragment of the product (live
   markup, no screenshots); the title and body sit outside it, on the page
   ground. No icons — the fragment is the illustration. */
export function Features() {
  return (
    <section id={anchorId(SITE.anchors.features)} aria-labelledby="features-heading" className="scroll-mt-20">
      <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 md:py-28 lg:py-32">
        <SectionHeader
          id="features-heading"
          eyebrow={SECTIONS.features.eyebrow}
          heading={SECTIONS.features.heading}
          sub={SECTIONS.features.sub}
        />
        <ul className="mt-12 grid gap-x-6 gap-y-12 sm:grid-cols-2 md:mt-16 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <li key={f.title}>
              <div aria-hidden="true" className="bg-secondary relative h-56 overflow-hidden rounded-2xl">
                <FeatureMock kind={f.visual} />
              </div>
              <h3 className="text-foreground mt-5 text-[17px] font-medium tracking-tight">{f.title}</h3>
              <p className="text-muted-foreground mt-1.5 text-[15px] leading-relaxed">{f.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
