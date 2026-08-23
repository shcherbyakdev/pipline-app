"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { WELCOME } from "@/features/marketing/site";
import { bookingUrl, hostLabel } from "@/lib/booking/url";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Shown once, driven by ?welcome=1 (nothing persisted). The public page 404s
// until a service exists, so the promise is "yours", not "live".
export function WelcomeBanner({ handle, appUrl }: { handle: string | null; appUrl: string }) {
  const router = useRouter();
  const [copied, setCopied] = React.useState(false);
  const url = handle ? bookingUrl(appUrl, handle) : null;

  const copy = () => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div role="status" className="bg-card flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3">
      <div className="mr-auto">
        <p className="text-sm font-medium">
          {url ? WELCOME.owned(`${hostLabel(appUrl)}/${handle}`) : WELCOME.noHandle}
        </p>
        <p className="text-muted-foreground text-xs">{url ? WELCOME.sub : WELCOME.noHandleSub}</p>
      </div>
      {url ? (
        <>
          <Link href="/services" className={cn(buttonVariants({ size: "sm" }))}>
            {WELCOME.addService}
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
