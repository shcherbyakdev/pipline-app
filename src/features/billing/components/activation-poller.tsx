"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

const EVERY_MS = 3_000;
const FOR_MS = 30_000;

/* Coming back from checkout, the plan is only real once the provider's
   webhook has landed — seconds, usually, but not zero (spec §7.7). So the
   page re-reads itself every 3s for 30s; the moment the row exists the server
   renders the paid plan, `active` goes false and the effect tears down.

   The status line lives here rather than on the page so it can change when
   the window runs out: a webhook that is late by more than 30s is a real
   condition (provider incident, a misrouted endpoint) and the member has
   paid — leaving "Activating…" on screen with nothing happening behind it
   would read as a hang. router.refresh() keeps client state, so `timedOut`
   survives every re-render the poll triggers. */
export function ActivationPoller({ active }: { active: boolean }) {
  const t = useTranslations("billing.activation");
  const router = useRouter();
  const [timedOut, setTimedOut] = React.useState(false);

  React.useEffect(() => {
    if (!active) return;
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      if (Date.now() - startedAt > FOR_MS) {
        window.clearInterval(id);
        setTimedOut(true);
        return;
      }
      router.refresh();
    }, EVERY_MS);
    return () => window.clearInterval(id);
  }, [active, router]);

  if (!active) return null;
  return (
    <p role="status" className="text-muted-foreground text-sm">
      {timedOut ? t("timedOut") : t("waiting")}
    </p>
  );
}
