"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { dismissPlanNotice } from "../notice-actions";

/** One plan nudge, gone for good once the owner closes it — until the thing
    it says changes, which is what `signature` carries (plan-notice.ts). The
    sentence arrives already translated: only the chrome is client-side. */
export function DismissibleNotice({
  kind,
  signature,
  text,
  cta,
}: {
  kind: string;
  signature: string;
  text: string;
  cta: { href: string; label: string } | null;
}) {
  const t = useTranslations("common");
  const te = useTranslations("errors");
  // Optimistic (welcome-banner.tsx precedent): the notice goes at once and
  // the action's cookie write keeps it gone on the next load.
  const [dismissed, setDismissed] = React.useState(false);
  const [, startTransition] = React.useTransition();
  if (dismissed) return null;

  return (
    <div
      role="status"
      className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border py-2 pr-1 pl-3 text-sm"
    >
      <span>{text}</span>
      {cta ? (
        <Link href={cta.href} className="text-foreground font-medium underline underline-offset-4">
          {cta.label}
        </Link>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        className="ml-auto"
        aria-label={t("dismiss")}
        onClick={() => {
          setDismissed(true);
          startTransition(async () => {
            try {
              await dismissPlanNotice(kind, signature);
            } catch {
              setDismissed(false);
              toast.error(te("generic"));
            }
          });
        }}
      >
        <HugeiconsIcon icon={Cancel01Icon} size={14} />
      </Button>
    </div>
  );
}
