import { AUDIENCE } from "@/features/marketing/site";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";
import { SECTION, SECTION_INNER } from "./type";

/* Who it's for: one soft panel, three columns, each opened by its title in
   the colour of the kind it names, with the businesses it means as white
   pills. Stacks below md. */
const COLOURS = ["text-kind-time-text", "text-kind-space-text", "text-kind-stay-text"];

export function Audience() {
  return (
    <section aria-labelledby="audience-heading" className={SECTION}>
      <div className={SECTION_INNER}>
        <Reveal className="bg-secondary grid gap-10 rounded-[28px] px-6 py-10 sm:px-10 sm:py-12 md:grid-cols-3 md:gap-12 lg:px-16 lg:py-16">
          <h2 id="audience-heading" className="sr-only">
            {AUDIENCE.heading}
          </h2>
          {AUDIENCE.blocks.map((b, i) => (
            <div key={b.title}>
              <h3 className={cn("text-[16px] leading-none font-semibold", COLOURS[i])}>{b.title}</h3>
              <p className="text-muted-foreground mt-3 text-[16px] leading-relaxed">{b.body}</p>
              {b.groups.length ? (
                <ul className="mt-4 flex flex-wrap gap-2">
                  {b.groups.map((g) => (
                    <li key={g} className="bg-card text-foreground rounded-full px-3 py-[7px] text-[13px] leading-none font-medium">
                      {g}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
