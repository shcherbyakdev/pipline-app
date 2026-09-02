import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PAGE_CHANNELS, type PageChannel } from "../channel";
import { SEGMENTED_NAV_CLASS, segmentedItemClass } from "@/components/ui/segmented";

/* Which of the org's two pages the studio is editing (spec 2026-08-28
   §4.2). Links, not tabs: the server loads the other page's draft and the
   builder re-mounts, so usePageDraft never has to switch documents.
   Rendered only for an org that declares both channels. */
export async function PageSwitch({ value }: { value: PageChannel }) {
  const t = await getTranslations("studio.pageSwitch");
  return (
    <nav aria-label={t("label")} className={SEGMENTED_NAV_CLASS}>
      {PAGE_CHANNELS.map((channel) => (
        <Link
          key={channel}
          href={`/booking-page?page=${channel}`}
          aria-current={value === channel ? "page" : undefined}
          className={segmentedItemClass(value === channel)}
        >
          {t(channel)}
        </Link>
      ))}
    </nav>
  );
}
