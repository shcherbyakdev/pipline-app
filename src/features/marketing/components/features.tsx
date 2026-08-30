import { anchorId, FEATURES, SECTIONS, SITE, type FeatureVisual } from "@/features/marketing/site";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";
import { FeatureCell } from "./feature-cells";
import { H2, LEAD, SECTION, SECTION_INNER } from "./type";

/* A centred heading, then the seven features as a bento with rhythm: 2+1,
   1+1+1, 2+1. Three cells are tinted (blue, orange, green) and one is ink,
   the rest sit on the soft grey; every cell holds a product fragment. */
const LAYOUT: Record<FeatureVisual, string> = {
  "slot-guard": "bg-kind-time-soft lg:col-span-2",
  page: "bg-secondary",
  manage: "bg-secondary",
  reminder: "bg-kind-stay-soft",
  embed: "bg-foreground text-background",
  spaces: "bg-kind-space-soft lg:col-span-2",
  brand: "bg-secondary",
};
const ORDER: FeatureVisual[] = ["slot-guard", "page", "manage", "reminder", "embed", "spaces", "brand"];

export function Features() {
  const byVisual = new Map(FEATURES.map((f) => [f.visual, f]));
  return (
    <section id={anchorId(SITE.anchors.features)} aria-labelledby="features-heading" className={cn(SECTION, "scroll-mt-20")}>
      <div className={SECTION_INNER}>
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 id="features-heading" className={H2}>
            {SECTIONS.features.heading}
          </h2>
          <p className={cn(LEAD, "mx-auto max-w-lg")}>{SECTIONS.features.sub}</p>
        </Reveal>

        <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ORDER.map((visual, i) => {
            const f = byVisual.get(visual)!;
            const ink = visual === "embed";
            return (
              <Reveal as="li" key={visual} delay={(i % 3) * 60} className={cn("flex min-w-0 flex-col rounded-[22px] p-[22px]", LAYOUT[visual])}>
                <div aria-hidden="true">
                  <FeatureCell visual={visual} />
                </div>
                <h3 className="mt-[18px] text-[19px] leading-snug font-medium tracking-[-0.01em]">{f.title}</h3>
                <p className={cn("mt-1.5 max-w-[40ch] text-[14.5px] leading-relaxed", ink ? "text-background/70" : "text-muted-foreground")}>{f.body}</p>
              </Reveal>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
