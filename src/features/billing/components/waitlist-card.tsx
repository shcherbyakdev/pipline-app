import Link from "next/link";
import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, CrownIcon } from "@hugeicons/core-free-icons";

/* The sidebar widget: one card, the whole thing a link to /waitlist. Shown
   only while the org is on Free and not yet on the list — the layout decides
   (the shell has no data of its own), so this stays a dumb block. */
export function WaitlistCard({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations("billing.waitlist");
  return (
    <Link
      href="/waitlist"
      onClick={onNavigate}
      className="border-brand/30 bg-brand/10 hover:bg-brand/15 hover:border-brand/50 focus-visible:ring-ring/40 group mb-3 flex flex-col gap-1.5 rounded-[10px] border p-3 transition-colors duration-150 ease-strong outline-none focus-visible:ring-2"
    >
      <span className="text-brand-text flex items-center gap-1.5 text-[12.5px] font-semibold">
        <HugeiconsIcon icon={CrownIcon} size={14} className="text-brand-text shrink-0" />
        {t("cardTitle")}
      </span>
      <span className="text-foreground/80 text-[12px] leading-snug">{t("cardBody")}</span>
      <span className="text-brand-text mt-0.5 flex items-center gap-1 text-[12px] font-medium">
        {t("cardCta")}
        <HugeiconsIcon icon={ArrowRight01Icon} size={13} className="transition-transform duration-150 ease-strong group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}
