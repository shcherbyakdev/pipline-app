"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { WELCOME } from "@/features/marketing/site";
import { bookingUrl, hostLabel } from "@/lib/booking/url";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OrgMode } from "@/features/orgs/mode";

// Shown once, driven by ?welcome=1 (nothing persisted). The public page 404s
// until a service exists, so the promise is "yours", not "live". `mode` is
// the EFFECTIVE mode (features/orgs/mode.ts effectiveMode — the caller
// composes it with the rentals kill switch), so a rentals-only org whose
// channel is currently killed still lands on the appointments CTA rather
// than a link to a channel it can't reach.
export function WelcomeBanner({
  handle,
  appUrl,
  mode,
}: {
  handle: string | null;
  appUrl: string;
  mode: OrgMode;
}) {
  const router = useRouter();
  const [copied, setCopied] = React.useState(false);
  const url = handle ? bookingUrl(appUrl, handle) : null;
  // Rentals-only: the appointments CTA ("Add a service" → /services) would
  // dead-end this org. Anyone who still offers appointments (solo or both)
  // keeps the original copy and link.
  const rentalsOnly = !mode.offersAppointments;

  // Awaited: a refused clipboard write must not flip the button to "Copied"
  // (portal-links-panel.tsx precedent).
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — select the link text and copy manually.");
    }
  };

  return (
    <div role="status" className="bg-card flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3">
      <div className="mr-auto">
        <p className="text-sm font-medium">
          {url ? WELCOME.owned(`${hostLabel(appUrl)}/${handle}`) : WELCOME.noHandle}
        </p>
        <p className="text-muted-foreground text-xs">
          {url ? (rentalsOnly ? WELCOME.subRentals : WELCOME.sub) : WELCOME.noHandleSub}
        </p>
      </div>
      {url ? (
        <>
          <Link
            href={rentalsOnly ? "/rentals" : "/services"}
            className={cn(buttonVariants({ size: "sm" }))}
          >
            {rentalsOnly ? WELCOME.addOffering : WELCOME.addService}
          </Link>
          <Button size="sm" variant="outline" onClick={copy}>
            <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} size={14} />
            {copied ? WELCOME.copied : WELCOME.copyLink}
          </Button>
        </>
      ) : (
        <Link href="/booking-page" className={cn(buttonVariants({ size: "sm" }))}>
          {WELCOME.setUpPage}
        </Link>
      )}
      <Button size="sm" variant="ghost" aria-label={WELCOME.dismiss} onClick={() => router.replace("/bookings")}>
        <HugeiconsIcon icon={Cancel01Icon} size={14} />
      </Button>
    </div>
  );
}
