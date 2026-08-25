import { anchorId, FEATURES, type FeatureVisual, SECTIONS, SITE } from "@/features/marketing/site";
import { cn } from "@/lib/utils";
import { SectionHeader } from "./section-header";
import { Reveal } from "./reveal";
import { FeatureMock } from "./mocks/feature-mocks";

/* Feature panels in a bento: a sand panel holds a real fragment of the
   product (live markup, no screenshots); the title and body sit outside it,
   on the page ground. No icons — the fragment is the illustration. Widths
   vary with the fragment: the two that show a whole flow get 4/6 columns. */
const SPAN: Record<FeatureVisual, string> = {
  page: "lg:col-span-4",
  spaces: "lg:col-span-2",
  "slot-guard": "lg:col-span-2",
  manage: "lg:col-span-4",
  embed: "lg:col-span-2",
  reminder: "lg:col-span-2",
  brand: "lg:col-span-2",
};

export function Features() {
  return (
    <section id={anchorId(SITE.anchors.features)} aria-labelledby="features-heading" className="scroll-mt-20">
      <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 md:py-24 lg:py-28">
        <SectionHeader
          id="features-heading"
          eyebrow={SECTIONS.features.eyebrow}
          heading={SECTIONS.features.heading}
          sub={SECTIONS.features.sub}
        />
        <ul className="mt-12 grid gap-x-6 gap-y-12 sm:grid-cols-2 md:mt-16 lg:grid-cols-6">
          {FEATURES.map((f, i) => (
            <Reveal as="li" key={f.title} delay={(i % 3) * 80} className={SPAN[f.visual]}>
              <div
                aria-hidden="true"
                className={cn(
                  "bg-secondary ring-border/60 relative h-64 overflow-hidden rounded-2xl ring-1 ring-inset sm:h-72",
                  "before:pointer-events-none before:absolute before:inset-0 before:bg-[radial-gradient(60%_50%_at_100%_0%,color-mix(in_oklab,var(--highlight)_7%,transparent),transparent_70%)]",
                )}
              >
                <FeatureMock kind={f.visual} />
              </div>
              <h3 className="text-foreground mt-5 text-[17px] font-medium tracking-tight">{f.title}</h3>
              <p className="text-muted-foreground mt-1.5 max-w-md text-[15px] leading-relaxed">{f.body}</p>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
