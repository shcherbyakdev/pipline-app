"use client";

import * as React from "react";
import { SITE } from "@/features/marketing/site";
import { ClaimBar } from "./claim-bar";

/* The hero's one action: the claim bar, with the early-access note under
   it while it is idle. Owns the handle state the bar needs; the hero
   itself stays a server component around the screenshots. */
export function HeroClaim({ host, className }: { host: string; className?: string }) {
  const [handle, setHandle] = React.useState("");
  return <ClaimBar handle={handle} onHandleChange={setHandle} host={host} idleNote={SITE.heroNote} size="lg" className={className} />;
}
