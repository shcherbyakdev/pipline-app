"use client";

import * as React from "react";
import { FINAL_CTA, SITE } from "@/features/marketing/site";
import { ClaimBar } from "./claim-bar";

/* The ink slab: the page ends on the claim it opened with. `.ink` flips the
   text/hairline tokens (globals.css); the footer continues the same ground so
   the two read as one block. The rounded top lifts it off the paper. */
export function FinalCta({ host }: { host: string }) {
  const [handle, setHandle] = React.useState("");
  return (
    <section aria-labelledby="cta-heading" className="ink bg-background text-foreground rounded-t-[2rem] sm:rounded-t-[3rem]">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-5 pt-20 pb-16 text-center sm:px-8 md:pt-28 md:pb-24">
        <h2 id="cta-heading" className="text-foreground text-4xl font-medium tracking-[-0.035em] text-balance sm:text-5xl md:text-6xl">
          {FINAL_CTA.heading}
        </h2>
        <p className="text-muted-foreground mt-4 max-w-md text-base text-balance sm:text-lg">{FINAL_CTA.sub}</p>
        <ClaimBar handle={handle} onHandleChange={setHandle} host={host} idleNote={SITE.heroNote} size="lg" className="mt-8 max-w-xl" />
      </div>
    </section>
  );
}
