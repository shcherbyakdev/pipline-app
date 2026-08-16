import { anchorId, SECTIONS, SITE, STEPS } from "@/features/marketing/site";

export function HowItWorks() {
  return (
    <section id={anchorId(SITE.anchors.how)} aria-labelledby="how-heading" className="scroll-mt-20 border-t">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 md:py-28">
        <h2 id="how-heading" className="text-3xl font-semibold tracking-tight md:text-4xl">{SECTIONS.how.heading}</h2>
        <p className="text-muted-foreground mt-3 max-w-xl">{SECTIONS.how.sub}</p>
        <ol className="mt-12 grid gap-10 md:grid-cols-3 md:gap-8">
          {STEPS.map((s) => (
            <li key={s.number} className="border-t pt-6">
              <span className="text-primary font-mono text-sm font-medium tabular-nums">{s.number}</span>
              <h3 className="mt-3 text-lg font-medium tracking-tight text-balance">{s.title}</h3>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
