import { withLang } from "@/i18n/public-locale";
import { useLocale, useTranslations } from "next-intl";

// The post-booking panel, shared by the appointment and rental flows.
// Plain markup — no state, no client hooks — so it inherits whichever
// boundary imports it.
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
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <h2 className="font-semibold">{pending ? t("requestSent") : t("bookingConfirmed")}</h2>
      {summary ? (
        <div>
          <p className="font-medium">{summary.title}</p>
          <p>{summary.whenLine}</p>
        </div>
      ) : null}
      {staffName ? <p className="text-sm">{t("with", { name: staffName })}</p> : null}
      <p className="text-muted-foreground text-sm">
        {pending ? t("pendingBody") : t("confirmedBody")}
      </p>
      {/* New tab: inside the website embed these would otherwise navigate
          the iframe itself into the manage page (audit 2026-08-24).
          `?lang=` carries this page's language to the manage page. */}
      <a className="text-sm underline" href={withLang(`/booking/${token}`, locale)} target="_blank" rel="noopener">
        {pending ? t("viewRequest") : t("viewBooking")}
      </a>
      {/* No .ics while pending — nothing is on anyone's calendar yet. */}
      {pending ? null : (
        <a className="text-sm underline" href={`/booking/${token}/calendar.ics`} target="_blank" rel="noopener">
          {t("addToCalendar")}
        </a>
      )}
    </div>
  );
}
