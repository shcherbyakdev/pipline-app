"use client";

import * as React from "react";
import { FINAL_CTA, SITE } from "@/features/marketing/site";
import { ClaimBar } from "./claim-bar";

export function FinalCta({ host }: { host: string }) {
  const [handle, setHandle] = React.useState("");
  return (
    <section aria-labelledby="cta-heading" className="bg-secondary/60 border-border border-t">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-5 py-20 text-center sm:px-8 md:py-28">
        <h2 id="cta-heading" className="text-foreground text-3xl font-normal tracking-tight text-balance md:text-5xl">
          {FINAL_CTA.heading}
        </h2>
        <ClaimBar handle={handle} onHandleChange={setHandle} host={host} size="md" className="mt-8 max-w-lg" />
        <p className="text-muted-foreground mt-2 text-sm">{SITE.heroNote}</p>
      </div>
    </section>
  );
}
