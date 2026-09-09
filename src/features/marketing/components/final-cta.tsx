"use client";

import * as React from "react";
import { FINAL_CTA, SITE } from "@/features/marketing/site";
import { cn } from "@/lib/utils";
import { ClaimBar } from "./claim-bar";
import { Reveal } from "./reveal";
import { H2, PANEL, SECTION_INNER } from "./type";

/* The page closes on the claim, centred, on the landing's dark closing
   panel: the section opts into the `.dark` token scope and the sticky nav
   watches `data-nav-dark` to invert while over it. The footer shares the
   scope so the page ends dark. */
export function FinalCta({ host }: { host: string }) {
  const [handle, setHandle] = React.useState("");
  return (
    <section aria-labelledby="cta-heading" data-nav-dark className={cn(PANEL, "dark bg-background mt-16 flex min-h-[70dvh] flex-col justify-center py-20 sm:mt-20 md:mt-24 md:py-28")}>
      <div className={SECTION_INNER}>
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 id="cta-heading" className={cn(H2, "md:text-[52px]")}>
            {FINAL_CTA.heading}
          </h2>
          <p className="text-muted-foreground mx-auto mt-4 max-w-md text-[17px] leading-relaxed text-balance sm:text-lg">{FINAL_CTA.sub}</p>
          <ClaimBar handle={handle} onHandleChange={setHandle} host={host} idleNote={SITE.heroNote} size="lg" className="mx-auto mt-8 max-w-[520px] text-left" />
        </Reveal>
      </div>
    </section>
  );
}
