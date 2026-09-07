"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

/* Stripe's hosted onboarding lands back on the page with ?stripe=return
   (details saved) / ?stripe=refresh (the link expired before finishing —
   the card's Continue button mints a new one) / ?stripe=error. One toast,
   then the query is cleared so a reload does not repeat it. */
export function PaymentsNotice() {
  const t = useTranslations("payments.stripe");
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const fired = React.useRef(false);

  React.useEffect(() => {
    if (fired.current) return;
    const stripe = params.get("stripe");
    if (!stripe) return;
    fired.current = true;
    if (stripe === "return") toast.success(t("notice.return"));
    else if (stripe === "refresh") toast(t("notice.returnIncomplete"));
    else toast.error(t("notice.error"));
    router.replace(pathname);
  }, [params, pathname, router, t]);

  return null;
}
