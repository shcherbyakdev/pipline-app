import { anchorId, SECTIONS, SITE, STEPS } from "@/features/marketing/site";

export function HowItWorks() {
  return (
    <section id={anchorId(SITE.anchors.how)} aria-labelledby="how-heading" className="bg-background relative scroll-mt-20 pt-16 sm:pt-28 lg:pt-40">
      <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-8 md:py-24">
        <h2 id="how-heading" className="text-foreground text-3xl font-normal tracking-tight md:text-4xl">
          {SECTIONS.how.heading}
        </h2>
        <p className="text-muted-foreground mt-3 max-w-xl">{SECTIONS.how.sub}</p>
        <ol className="mt-10 grid gap-8 md:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.number} className="border-border border-t pt-5">
              <span className="text-highlight font-mono text-sm tabular-nums">{s.number}</span>
              <h3 className="text-foreground mt-3 text-lg font-medium tracking-tight text-balance">{s.title}</h3>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
