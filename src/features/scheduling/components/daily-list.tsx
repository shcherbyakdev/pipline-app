"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogBreadcrumbHeader,
  DialogChip,
  DialogContent,
  DialogDescription,
  DialogFooterBar,
  dialogBareInputClass,
  dialogPanelClass,
} from "@/components/ui/dialog";
import { markBookingPaid } from "@/features/scheduling/booking-actions";
import { sendBalanceLink, writeOffBooking } from "@/features/payments/actions";
import type { AdminBooking } from "@/features/scheduling/queries";
import type { BalanceDue, DailyList as DailyListData } from "@/features/scheduling/daily-list";
import { formatUntil, whenLineFor } from "@/features/scheduling/templates";
import { dateInZone } from "@/features/scheduling/slots";
import { ActionRow, RequestsInbox } from "./requests-inbox";
import { INTL_LOCALES } from "@/i18n/config";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

const nowMs = () => Date.now();

/* S4 (spec 2026-09-08): the Overview's first block. Three sections, each
   nothing when empty; the whole thing nothing when all are (ruling 4). */
export function DailyList({
  list,
  timeZone,
  canCollectOnline,
}: {
  list: DailyListData;
  timeZone: string;
  canCollectOnline: boolean;
}) {
  if (list.requests.length + list.holds.length + list.balances.length === 0) return null;
  return (
    <div className="flex flex-col gap-10">
      <RequestsInbox requests={list.requests} timeZone={timeZone} />
      <HoldsExpiring holds={list.holds} timeZone={timeZone} />
      <BalancesDue balances={list.balances} timeZone={timeZone} canCollectOnline={canCollectOnline} />
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        <span className="text-muted-foreground text-xs">{count}</span>
      </div>
      <ul className="bg-card divide-y rounded-xl border">{children}</ul>
    </section>
  );
}

function useWhen(timeZone: string) {
  const intlLocale = INTL_LOCALES[useLocale()];
  return {
    intlLocale,
    line: (b: AdminBooking) =>
      whenLineFor(
        { startsAt: new Date(b.startsAt), endsAt: new Date(b.endsAt), isRental: b.rentalUnitId !== null, rangeMode: b.rangeMode },
        timeZone,
        intlLocale,
      ),
  };
}

/* "Open" lands on the bookings page in Day view on the booking's date; the
   detail dialog has no URL of its own (spec choice 3). */
function OpenLink({ booking, timeZone }: { booking: AdminBooking; timeZone: string }) {
  const t = useTranslations("overview");
  return (
    <Link
      href={`/bookings?view=day&date=${dateInZone(new Date(booking.startsAt), timeZone)}`}
      className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
      aria-label={t("openFor", { name: booking.clientName })}
    >
      {t("open")}
    </Link>
  );
}

// ---------- holds ----------------------------------------------------------

function HoldsExpiring({ holds, timeZone }: { holds: AdminBooking[]; timeZone: string }) {
  const t = useTranslations("overview");
  return (
    <Section title={t("holds")} count={holds.length}>
      {holds.map((b) => (
        <HoldRow key={b.id} booking={b} timeZone={timeZone} />
      ))}
    </Section>
  );
}

function HoldRow({ booking, timeZone }: { booking: AdminBooking; timeZone: string }) {
  const t = useTranslations("overview");
  const tb = useTranslations("bookings");
  const router = useRouter();
  const { intlLocale, line } = useWhen(timeZone);
  const [pending, startTransition] = React.useTransition();
  // `Date.now()` is impure and react-hooks/purity forbids it during render
  // (booking-detail-dialog.tsx's nowMs idiom); useState's initialiser runs
  // once at mount, which is fine for "is this hold's deadline already past".
  const [now] = React.useState(nowMs);

  const deadline = booking.holdExpiresAt ? new Date(booking.holdExpiresAt) : null;
  const lapsed = deadline !== null && deadline.getTime() <= now;
  const detail = [
    line(booking),
    booking.serviceName,
    booking.depositCents !== null && booking.currency ? t("deposit", { amount: formatMoney(booking.depositCents, booking.currency) }) : null,
    deadline ? (lapsed ? tb("hold.lapsed") : tb("hold.until", { time: formatUntil(deadline, timeZone, intlLocale) })) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const markPaid = () =>
    startTransition(async () => {
      const result = await markBookingPaid({ id: booking.id });
      if (!result.ok) toast.error(result.error);
      else toast.success(tb("markPaid.done"));
      router.refresh();
    });

  return (
    <ActionRow title={booking.clientName} detail={detail}>
      <Button size="sm" onClick={markPaid} disabled={pending} aria-label={t("markPaidFor", { name: booking.clientName })}>
        {t("markPaid")}
      </Button>
      <OpenLink booking={booking} timeZone={timeZone} />
    </ActionRow>
  );
}

// ---------- balances -------------------------------------------------------

function BalancesDue({
  balances,
  timeZone,
  canCollectOnline,
}: {
  balances: BalanceDue[];
  timeZone: string;
  canCollectOnline: boolean;
}) {
  const t = useTranslations("overview");
  return (
    <Section title={t("balances")} count={balances.length}>
      {balances.map((b) => (
        <BalanceRow key={b.id} booking={b} timeZone={timeZone} canCollectOnline={canCollectOnline} />
      ))}
    </Section>
  );
}

function BalanceRow({
  booking,
  timeZone,
  canCollectOnline,
}: {
  booking: BalanceDue;
  timeZone: string;
  canCollectOnline: boolean;
}) {
  const t = useTranslations("overview");
  const tc = useTranslations("bookings.charges");
  const router = useRouter();
  const { line } = useWhen(timeZone);
  const [pending, startTransition] = React.useTransition();
  const [confirmPaid, setConfirmPaid] = React.useState(false);
  const [writingOff, setWritingOff] = React.useState(false);
  const currency = booking.currency ?? "PLN";
  const detail = [line(booking), booking.serviceName, tc("balanceDue", { amount: formatMoney(booking.balanceCents, currency) })].join(" · ");

  const markPaid = () =>
    startTransition(async () => {
      const result = await markBookingPaid({ id: booking.id });
      if (!result.ok) toast.error(result.error);
      else toast.success(tc("paid"));
      setConfirmPaid(false);
      router.refresh();
    });
  const sendLink = () =>
    startTransition(async () => {
      const result = await sendBalanceLink({ id: booking.id });
      if (!result.ok) toast.error(result.error);
      else toast.success(tc("linkSent"));
    });

  return (
    <>
      <ActionRow title={booking.clientName} detail={detail}>
        {/* Two clicks, as the charges block does: the first arms, the second
            records the whole balance as cash (S7 decision 4). */}
        {confirmPaid ? (
          <Button variant="brand" size="sm" onClick={markPaid} disabled={pending} aria-label={t("markPaidFor", { name: booking.clientName })}>
            {tc("markPaidConfirm")}
          </Button>
        ) : (
          <Button size="sm" onClick={() => setConfirmPaid(true)} disabled={pending} aria-label={t("markPaidFor", { name: booking.clientName })}>
            {t("markPaid")}
          </Button>
        )}
        {canCollectOnline && booking.clientEmail ? (
          <Button variant="outline" size="sm" onClick={sendLink} disabled={pending} aria-label={t("sendLinkFor", { name: booking.clientName })}>
            {tc("sendLink")}
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={() => setWritingOff(true)} disabled={pending} aria-label={t("writeOffFor", { name: booking.clientName })}>
          {tc("writeOff")}
        </Button>
        <OpenLink booking={booking} timeZone={timeZone} />
      </ActionRow>
      <WriteOffDialog bookingId={booking.id} open={writingOff} onOpenChange={setWritingOff} />
    </>
  );
}

/* Write-off with an optional note — the DeclineRequestDialog skeleton. */
function WriteOffDialog({
  bookingId,
  open,
  onOpenChange,
}: {
  bookingId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("overview");
  const tc = useTranslations("bookings.charges");
  const tb = useTranslations("bookings");
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [note, setNote] = React.useState("");
  const noteId = React.useId();

  const change = (next: boolean) => {
    if (!next) setNote("");
    onOpenChange(next);
  };

  const writeOff = () =>
    startTransition(async () => {
      const result = await writeOffBooking({ id: bookingId, note: note.trim() || undefined });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(tc("writtenOffDone"));
      change(false);
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className={dialogPanelClass}>
        <DialogBreadcrumbHeader chip={<DialogChip tone="time">{t("balances")}</DialogChip>}>
          {t("writeOffTitle")}
        </DialogBreadcrumbHeader>
        <div className="flex flex-col px-5 pt-4 pb-6">
          <DialogDescription>{t("writeOffBody")}</DialogDescription>
          <textarea
            id={noteId}
            aria-label={t("writeOffNote")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder={t("writeOffNotePlaceholder")}
            className={cn(dialogBareInputClass, "mt-4 resize-none text-sm")}
          />
        </div>
        <DialogFooterBar>
          <Button variant="ghost" size="sm" onClick={() => change(false)} disabled={pending}>
            {tb("keep")}
          </Button>
          <Button variant="destructive" size="sm" onClick={writeOff} disabled={pending}>
            {tc("writeOffConfirm")}
          </Button>
        </DialogFooterBar>
      </DialogContent>
    </Dialog>
  );
}
