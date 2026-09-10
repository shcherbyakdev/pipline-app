"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, CheckmarkCircle01Icon, CircleIcon, Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { bookingUrl, hostLabel } from "@/lib/booking/url";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OrgMode } from "@/features/orgs/mode";
import type { ChecklistItem } from "@/features/scheduling/setup-checklist";
import { useTranslations } from "next-intl";
import { dismissWelcome } from "@/features/scheduling/setup-actions";

// Shown on every Bookings load until the checklist is done or the owner
// dismisses it (setup-checklist.ts showWelcome; the dismissal is a cookie).
// The public page 404s until something is bookable, so the promise is
// "yours", not "live". `mode` is the EFFECTIVE mode (features/orgs/mode.ts
// effectiveMode — the caller composes it with the rentals kill switch). The
// checklist is computed by the page (setup-checklist.ts) from data that
// already exists.
export function WelcomeBanner({
  handle,
  appUrl,
  mode,
  checklist,
}: {
  handle: string | null;
  appUrl: string;
  mode: OrgMode;
  checklist: ChecklistItem[];
}) {
  const t = useTranslations("bookings.welcome");
  const tCommon = useTranslations("common");
  const tChecklist = useTranslations("bookings.checklist");
  const [copied, setCopied] = React.useState(false);
  // Optimistic: the banner goes at once; the action's cookie write
  // re-renders the page so it stays gone on the next load.
  const [dismissed, setDismissed] = React.useState(false);
  const [, startTransition] = React.useTransition();
  const url = handle ? bookingUrl(appUrl, handle) : null;
  const sub = mode.offersAppointments ? t("sub") : t("subSpaces");

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

  const dismiss = () => {
    setDismissed(true);
    startTransition(async () => {
      try {
        await dismissWelcome();
      } catch {
        setDismissed(false);
        toast.error("Couldn't dismiss — try again.");
      }
    });
  };

  if (dismissed) return null;
  return (
    <div role="status" className="bg-card flex flex-col gap-3 rounded-xl border px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <p className="text-sm font-medium">
            {url ? t("owned", { url: `${hostLabel(appUrl)}/${handle}` }) : t("noHandle")}
          </p>
          <p className="text-muted-foreground text-xs">{url ? sub : t("noHandleSub")}</p>
        </div>
        {url ? (
          <Button size="sm" variant="outline" onClick={copy}>
            <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} size={14} />
            {copied ? tCommon("linkCopied") : tCommon("copyLink")}
          </Button>
        ) : (
          <Link href="/booking-page" className={cn(buttonVariants({ size: "sm" }))}>
            {t("setUpPage")}
          </Link>
        )}
        <Button size="sm" variant="ghost" aria-label={tCommon("dismiss")} onClick={dismiss}>
          <HugeiconsIcon icon={Cancel01Icon} size={14} />
        </Button>
      </div>
      {/* Setup chips: one per channel the org sells, plus hours and publish.
          A done item stays visible (struck through) so the row reads as
          progress, not as a shrinking to-do list. */}
      {url && checklist.length > 0 ? (
        <ul aria-label={t("checklist")} className="flex flex-wrap items-center gap-2">
          {checklist.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                aria-label={item.done ? t("done", { label: tChecklist(item.labelKey) }) : tChecklist(item.labelKey)}
                className={cn(buttonVariants({ size: "sm", variant: item.done ? "ghost" : "outline" }))}
              >
                <HugeiconsIcon
                  icon={item.done ? CheckmarkCircle01Icon : CircleIcon}
                  size={14}
                  className={item.done ? "text-primary" : "text-muted-foreground"}
                />
                <span className={item.done ? "line-through opacity-70" : undefined}>{tChecklist(item.labelKey)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
