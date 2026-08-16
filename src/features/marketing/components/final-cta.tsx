import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CTA, SITE } from "@/features/marketing/site";

export function FinalCta() {
  return (
    <section aria-labelledby="cta-heading" className="bg-muted/40 border-t">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 text-center md:py-28">
        <h2 id="cta-heading" className="text-3xl font-semibold tracking-tight text-balance md:text-5xl">{SITE.headline}</h2>
        <p className="text-muted-foreground mx-auto mt-4 max-w-md">{SITE.heroNote}</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href={SITE.links.signup} className={cn(buttonVariants({ size: "lg" }), "h-11 px-5 text-base")}>
            {CTA.getStartedFree}
          </Link>
          <Link href={SITE.links.login} className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "h-11 px-4 text-base")}>
            {CTA.login}
          </Link>
        </div>
      </div>
    </section>
  );
}
