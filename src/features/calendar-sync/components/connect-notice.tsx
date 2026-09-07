"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

/* The OAuth callback lands on the page with ?connected=1 / ?reconnected=1
   / ?error=<reason>. One toast, then the query is cleared so a reload
   does not repeat it. */
export function ConnectNotice() {
  const t = useTranslations("integrations.google.notice");
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const fired = React.useRef(false);

  React.useEffect(() => {
    if (fired.current) return;
    const error = params.get("error");
    const connected = params.get("connected") || params.get("reconnected");
    if (!error && !connected) return;
    fired.current = true;
    if (error) {
      const key = (["plan", "denied", "state", "google", "no_calendars"] as const).find((k) => k === error) ?? "google";
      toast.error(t(`error.${key}`));
    } else {
      toast.success(t(params.get("reconnected") ? "reconnected" : "connected"));
    }
    router.replace(pathname);
  }, [params, pathname, router, t]);

  return null;
}
