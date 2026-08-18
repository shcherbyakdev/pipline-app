"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

const EVERY_MS = 3_000;
const FOR_MS = 30_000;

/* Coming back from checkout, the plan is only real once the provider's
   webhook has landed — seconds, usually, but not zero (spec §7.7). So the
   page re-reads itself every 3s for 30s; the moment the row exists the server
   renders the paid plan, `active` goes false and the effect tears down. */
export function ActivationPoller({ active }: { active: boolean }) {
  const router = useRouter();

  React.useEffect(() => {
    if (!active) return;
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      if (Date.now() - startedAt > FOR_MS) {
        window.clearInterval(id);
        return;
      }
      router.refresh();
    }, EVERY_MS);
    return () => window.clearInterval(id);
  }, [active, router]);

  return null;
}
