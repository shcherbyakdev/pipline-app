import { useTranslations } from "next-intl";
import { env } from "@/env";

/* The growth loop (spec §5): every public booking surface carries the badge
   unless the org is on a plan that may hide it AND asked to (badgeVisible —
   lib/billing/entitlements.ts holds that rule; this component only renders).
   `?ref=badge&org=` makes the loop measurable: which org sent the visitor. */
export function PoweredBy({ handle }: { handle: string }) {
  const t = useTranslations("public");
  return (
    <p className="mt-4 text-center text-xs opacity-60">
      <a
        href={`${env.NEXT_PUBLIC_APP_URL}/?ref=badge&org=${encodeURIComponent(handle)}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        {t("poweredBy")}
      </a>
    </p>
  );
}
