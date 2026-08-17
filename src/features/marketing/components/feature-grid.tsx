import type { LucideIcon } from "lucide-react";
import { BellRing, CalendarCheck, CodeXml, Globe, Palette, RefreshCw } from "lucide-react";
import { anchorId, FEATURES, type FeatureIcon, SECTIONS, SITE } from "@/features/marketing/site";

const ICONS: Record<FeatureIcon, LucideIcon> = {
  globe: Globe,
  code: CodeXml,
  "calendar-check": CalendarCheck,
  refresh: RefreshCw,
  bell: BellRing,
  palette: Palette,
};

export function FeatureGrid() {
  return (
    <section id={anchorId(SITE.anchors.features)} aria-labelledby="features-heading" className="bg-muted/40 scroll-mt-20 border-t">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 md:py-28">
        <h2 id="features-heading" className="text-3xl font-medium tracking-[-0.03em] md:text-4xl">{SECTIONS.features.heading}</h2>
        <p className="text-muted-foreground mt-3 max-w-xl">{SECTIONS.features.sub}</p>
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => {
            const Icon = ICONS[f.icon];
            return (
              <li key={f.title} className="bg-card rounded-xl border p-6">
                <div className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-lg">
                  <Icon className="size-4" aria-hidden="true" />
                </div>
                <h3 className="mt-4 font-medium">{f.title}</h3>
                <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">{f.body}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
