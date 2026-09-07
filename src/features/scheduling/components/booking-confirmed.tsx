import { withLang } from "@/i18n/public-locale";
import { useLocale, useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import { Tick02Icon } from "@hugeicons/core-free-icons";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CHIP } from "@/features/booking-page/render/type";

// The post-booking panel, shared by the appointment and rental flows.
// Plain markup — no state, no client hooks — so it inherits whichever
// boundary imports it. The "Booked" moment, on the ground: an accent disc
// with the check, the title, what was booked, then the two ways on.
export function BookingConfirmed({
  token,
  summary,
  staffName,
  pending,
}: {
  token: string;
  summary?: { title: string; whenLine: string };
  /** Whom the booking landed with. Null for solo orgs — createBooking only
      names a person when the org actually has a team to tell apart. */
  staffName?: string | null;
  /** Approval (0062): the service/space requires approval, so this landed as
      a REQUEST — nothing is booked and nothing is on a calendar yet. */
  pending?: boolean;
}) {
  const t = useTranslations("public.confirmed");
  const locale = useLocale();
  return (
    <div className="wt-enter flex flex-col gap-4 py-2">
      <div className="flex items-start gap-3">
        <span aria-hidden className="wt-primary wt-round flex size-9 shrink-0 items-center justify-center rounded-full">
          <HugeiconsIcon icon={Tick02Icon} size={18} strokeWidth={2.5} />
        </span>
        <div className="min-w-0 pt-1">
          <h2 className="text-[17px] leading-tight font-medium">{pending ? t("requestSent") : t("bookingConfirmed")}</h2>
          {summary ? (
            <p className="mt-1.5 text-sm">
              <span className="font-medium">{summary.title}</span>
              <span className="text-muted-foreground"> · </span>
              <span className="tabular-nums">{summary.whenLine}</span>
            </p>
          ) : null}
          {staffName ? <p className="mt-0.5 text-sm">{t("with", { name: staffName })}</p> : null}
          <p className="text-muted-foreground mt-1.5 text-sm text-pretty">
            {pending ? t("pendingBody") : t("confirmedBody")}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 sm:pl-12">
        {/* New tab: inside the website embed these would otherwise navigate
            the iframe itself into the manage page (audit 2026-08-24).
            `?lang=` carries this page's language to the manage page. */}
        <a className={cn(buttonVariants({ variant: "outline" }), CHIP, "h-9 px-3.5")} href={withLang(`/booking/${token}`, locale)} target="_blank" rel="noopener">
          {pending ? t("viewRequest") : t("viewBooking")}
        </a>
        {/* No .ics while pending — nothing is on anyone's calendar yet. */}
        {pending ? null : (
          <a className={cn(buttonVariants({ variant: "outline" }), CHIP, "h-9 px-3.5")} href={`/booking/${token}/calendar.ics`} target="_blank" rel="noopener">
            {t("addToCalendar")}
          </a>
        )}
      </div>
    </div>
  );
}
