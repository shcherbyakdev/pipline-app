import { anchorId, SECTIONS, SITE, STEP_POINTS, STEPS } from "@/features/marketing/site";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";
import { AddScene, BookScene, ShareScene, Stage } from "./how-scenes";
import { H2, LEAD, SECTION, SECTION_INNER } from "./type";

/* A centred heading, then the three steps: the first two as text beside a
   product stage (the second flipped), the third full width with its stage
   below, so the page never repeats the split three times. No labels above
   the step headings: the heading's first word is the verb, and the kind
   colours live in the stages. */
const SCENES = [AddScene, ShareScene, BookScene];

function StepText({ i }: { i: number }) {
  const s = STEPS[i];
  return (
    <div>
      <h3 className="text-foreground text-[28px] leading-[1.12] font-medium tracking-[-0.02em] text-balance sm:text-[34px]">{s.title}</h3>
      <p className="text-muted-foreground mt-4 max-w-[36rem] text-[16px] leading-relaxed">{s.body}</p>
      <ul className="border-border mt-6 grid grid-cols-2 gap-x-5 gap-y-2.5 border-t pt-6 text-[14.5px] sm:flex sm:flex-wrap sm:gap-x-7">
        {STEP_POINTS[i].map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </div>
  );
}

export function HowItWorks() {
  return (
    <section id={anchorId(SITE.anchors.how)} aria-labelledby="how-heading" className={cn(SECTION, "scroll-mt-20")}>
      <div className={SECTION_INNER}>
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 id="how-heading" className={H2}>
            {SECTIONS.how.heading}
          </h2>
          <p className={cn(LEAD, "mx-auto max-w-lg")}>{SECTIONS.how.sub}</p>
        </Reveal>

        {[0, 1].map((i) => {
          const Scene = SCENES[i];
          return (
            <div key={i} className="mt-14 grid items-center gap-8 md:mt-16 lg:grid-cols-[1fr_1.2fr] lg:gap-16">
              <Reveal className={cn("min-w-0", i === 1 && "lg:order-2")}>
                <StepText i={i} />
              </Reveal>
              <Reveal delay={60} className="min-w-0">
                <Stage>
                  <Scene />
                </Stage>
              </Reveal>
            </div>
          );
        })}

        <div className="mt-20 md:mt-24">
          <Reveal className="max-w-[40rem]">
            <StepText i={2} />
          </Reveal>
          <Reveal delay={60} className="mt-9">
            <Stage>
              <BookScene />
            </Stage>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
