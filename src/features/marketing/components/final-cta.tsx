import Link from "next/link";
import { MoveRight } from "lucide-react";
import { CTA, SITE } from "@/features/marketing/site";
import { marketingButton } from "./marketing-button";

export function FinalCta() {
  return (
    <section aria-labelledby="cta-heading" className="bg-muted/40 border-t">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 text-center md:py-28">
        <h2 id="cta-heading" className="text-3xl font-medium tracking-[-0.03em] text-balance md:text-5xl">{SITE.headline}</h2>
        <p className="text-muted-foreground mx-auto mt-4 max-w-md">{SITE.heroNote}</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
          <Link href={SITE.links.signup} className={marketingButton("primary", "lg")}>
            <MoveRight className="size-6" strokeWidth={1.5} aria-hidden="true" />
            <span className="flex-1 text-center">{CTA.getStartedFree}</span>
          </Link>
          <Link href={SITE.links.login} className={marketingButton("quiet", "text")}>
            {CTA.login}
          </Link>
        </div>
      </div>
    </section>
  );
}
