import Link from "next/link";
import { PREMIUM, SITE } from "@/features/marketing/site";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";
import { marketingButton } from "./marketing-button";
import { H2, LEAD, SECTION, SECTION_INNER } from "./type";

/* Premium, while it is a waitlist: one soft panel, the pitch on the left and
   what joining unlocks on the right, the CTA into the dashboard's /waitlist
   (the app sends a signed-out visitor through login and back). Retires
   itself once billing is live (PREMIUM.shown) — /pricing takes over. */
export function Premium() {
  if (!PREMIUM.shown) return null;
  return (
    <section aria-labelledby="premium-heading" className={SECTION}>
      <div className={SECTION_INNER}>
        <Reveal className="bg-secondary grid gap-10 rounded-[28px] px-6 py-10 sm:px-10 sm:py-12 md:grid-cols-[1.2fr_1fr] md:gap-16 lg:px-16 lg:py-16">
          <div>
            <p className="text-brand-text text-[13px] font-semibold tracking-[0.02em] uppercase">{PREMIUM.eyebrow}</p>
            <h2 id="premium-heading" className={cn(H2, "mt-3")}>
              {PREMIUM.heading}
            </h2>
            <p className={LEAD}>{PREMIUM.sub}</p>
            <div className="mt-8 flex flex-col items-start gap-3">
              <Link href={SITE.links.waitlist} className={marketingButton("primary", "lg")}>
                {PREMIUM.cta}
              </Link>
              <p className="text-muted-foreground text-[13px]">{PREMIUM.note}</p>
            </div>
          </div>
          <ul className="flex flex-col gap-3 self-center">
            {PREMIUM.perks.map((perk) => (
              <li key={perk} className="bg-card text-foreground flex items-center gap-3 rounded-2xl px-4 py-3 text-[15px] font-medium">
                <span aria-hidden="true" className="bg-brand-text size-1.5 shrink-0 rounded-full" />
                {perk}
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
