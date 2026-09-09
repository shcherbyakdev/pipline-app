import { BellRing, CheckCheck, Code2, Languages, ShieldCheck, UserRound, type LucideIcon } from "lucide-react";
import { anchorId, FEATURES, SECTIONS, SITE, type FeatureIcon } from "@/features/marketing/site";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";
import { H2, LEAD, SECTION, SECTION_INNER } from "./type";

/* Everything else, as a bento with rhythm on four columns: 2+1+1 over
   1+1+2, six cells for six things, the wide cell swapping sides. Cells vary by ground, not by chrome: the guard cell is wide
   and lavender, one is mint, the embed cell is ink with the real one-line
   snippet, the rest sit on the soft grey. No rings, no shadows; the
   grounds do the grouping. Informational, so still. */
const ICON: Record<FeatureIcon, LucideIcon> = {
  "no-account": UserRound,
  guard: ShieldCheck,
  approve: CheckCheck,
  notify: BellRing,
  language: Languages,
  embed: Code2,
};
const CELL: Record<FeatureIcon, string> = {
  guard: "bg-kind-time-soft sm:col-span-2",
  "no-account": "bg-secondary",
  approve: "bg-kind-space-soft",
  notify: "bg-secondary",
  language: "bg-secondary",
  embed: "dark bg-background text-foreground sm:col-span-2",
};
const ORDER: FeatureIcon[] = ["guard", "no-account", "approve", "notify", "language", "embed"];

export function Features({ host }: { host: string }) {
  const byIcon = new Map(FEATURES.map((f) => [f.icon, f]));
  return (
    <section id={anchorId(SITE.anchors.features)} aria-labelledby="features-heading" className={cn(SECTION, "scroll-mt-20")}>
      <div className={SECTION_INNER}>
        <Reveal>
          <h2 id="features-heading" className={H2}>
            {SECTIONS.features.heading}
          </h2>
          <p className={LEAD}>{SECTIONS.features.sub}</p>
        </Reveal>

        <ul className="mt-12 grid gap-3 sm:grid-cols-2 md:mt-16 lg:grid-cols-4">
          {ORDER.map((icon, i) => {
            const f = byIcon.get(icon)!;
            const Icon = ICON[icon];
            const ink = icon === "embed";
            return (
              <Reveal as="li" key={icon} delay={(i % 4) * 50} className={cn("flex min-w-0 flex-col rounded-[24px] p-6 sm:p-7", CELL[icon])}>
                <span className={cn("flex size-10 items-center justify-center rounded-full", ink ? "bg-secondary text-brand-text" : "bg-card text-brand-text shadow-[var(--shadow-lift)]")} aria-hidden="true">
                  <Icon className="size-5" strokeWidth={2} />
                </span>
                <h3 className="text-foreground mt-7 text-[19px] leading-snug font-medium tracking-[-0.01em]">{f.title}</h3>
                <p className="text-muted-foreground mt-1.5 max-w-[40ch] text-[15px] leading-relaxed">{f.body}</p>
                {ink ? (
                  <pre aria-hidden="true" className="bg-secondary text-muted-foreground mt-5 overflow-x-auto rounded-[12px] px-3.5 py-3 font-mono text-[12px] leading-relaxed">
                    {/* the second line of the real snippet (orgs/components/widget-embed-snippet.ts) */}
                    <code>
                      {"<script src=\"https://"}
                      <span className="text-brand-text">{host}</span>
                      {"/embed.js\" async></script>"}
                    </code>
                  </pre>
                ) : null}
              </Reveal>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
