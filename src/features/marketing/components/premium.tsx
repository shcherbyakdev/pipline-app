import Link from "next/link";
import { Check } from "lucide-react";
import { PREMIUM, SITE } from "@/features/marketing/site";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";
import { marketingButton } from "./marketing-button";
import { H2, LEAD, PANEL } from "./type";

/* Premium, while it is a waitlist: one lavender panel, the pitch on the
   left and what joining unlocks on the right, the CTA into the dashboard's
   /waitlist (the app sends a signed-out visitor through login and back).
   Retires itself once billing is live (PREMIUM.shown) — /pricing takes over. */
export function Premium() {
  if (!PREMIUM.shown) return null;
  return (
    <section aria-labelledby="premium-heading" className={cn(PANEL, "panel-wash mt-16 py-16 sm:mt-20 sm:py-20 md:mt-24 md:py-24")}>
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 sm:px-10 md:grid-cols-[1.2fr_1fr] md:gap-16 lg:px-16">
        <div>
          <p className="text-brand-text text-[13px] font-semibold tracking-[0.02em] uppercase">{PREMIUM.eyebrow}</p>
          <h2 id="premium-heading" className={cn(H2, "mt-3")}>
            {PREMIUM.heading}
          </h2>
          <p className={LEAD}>{PREMIUM.sub}</p>
          <div className="mt-8 flex flex-col items-start gap-3">
            <Link href={SITE.links.waitlist} className={marketingButton("brand", "lg")}>
              {PREMIUM.cta}
            </Link>
            <p className="text-muted-foreground text-[13px]">{PREMIUM.note}</p>
          </div>
        </div>
        <Reveal className="self-center">
          <ul className="flex flex-col gap-3">
            {PREMIUM.perks.map((perk) => (
              <li key={perk} className="bg-card text-foreground flex items-center gap-3 rounded-2xl px-4 py-3.5 text-[15px] font-medium shadow-[var(--shadow-lift)]">
                <span aria-hidden="true" className="bg-kind-space-soft text-kind-space-text flex size-6 shrink-0 items-center justify-center rounded-full">
                  <Check className="size-3.5" strokeWidth={3} />
                </span>
                {perk}
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
