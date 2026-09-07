"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { whenLineFor } from "@/features/scheduling/templates";
import {
  acceptBookingRequest,
  declineBookingRequest,
} from "@/features/scheduling/booking-actions";
import type { AdminBooking } from "@/features/scheduling/queries";
import { INTL_LOCALES } from "@/i18n/config";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";

/* Decline-with-a-message popup. Owns the action, the toast and the refresh so
   all three callers stay thin: this file's inbox rows, the bookings list, and
   the booking-detail dialog — which passes `onDeclined` to close itself
   afterwards (the two inline rows have nothing to close). */
export function DeclineRequestDialog({
  bookingId,
  open,
  onOpenChange,
  onDeclined,
}: {
  bookingId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeclined?: () => void;
}) {
  const t = useTranslations("bookings");
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [note, setNote] = React.useState("");
  const noteId = React.useId();

  const change = (next: boolean) => {
    // A message typed and then abandoned shouldn't greet the next open.
    if (!next) setNote("");
    onOpenChange(next);
  };

  const decline = () =>
    startTransition(async () => {
      const result = await declineBookingRequest({
        id: bookingId,
        note: note.trim() || undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("requests.declined"));
      change(false);
      onDeclined?.();
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className={dialogPanelClass}>
        <DialogBreadcrumbHeader
          chip={<DialogChip tone="time">{t("requests.chip")}</DialogChip>}
        >
          {t("requests.declineTitle")}
        </DialogBreadcrumbHeader>
        <div className="flex flex-col px-5 pt-4 pb-6">
          <DialogDescription>{t("requests.declineBody")}</DialogDescription>
          <textarea
            id={noteId}
            aria-label={t("requests.declineNote")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder={t("requests.declineNotePlaceholder")}
            className={cn(dialogBareInputClass, "mt-4 resize-none text-sm")}
          />
        </div>
        <DialogFooterBar>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => change(false)}
            disabled={pending}
          >
            {t("keep")}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={decline}
            disabled={pending}
          >
            {pending ? t("requests.declining") : t("requests.declineTitle")}
          </Button>
        </DialogFooterBar>
      </DialogContent>
    </Dialog>
  );
}

function RequestRow({
  booking,
  timeZone,
}: {
  booking: AdminBooking;
  timeZone: string;
}) {
  const t = useTranslations("bookings");
  const intlLocale = INTL_LOCALES[useLocale()];
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [declining, setDeclining] = React.useState(false);

  const accept = () =>
    startTransition(async () => {
      const result = await acceptBookingRequest({ id: booking.id });
      if (!result.ok) toast.error(result.error);
      else
        toast.success(
          result.held
            ? t("requests.acceptedHeld")
            : result.emailed
              ? t("requests.acceptedEmailed")
              : t("requests.accepted"),
        );
      router.refresh();
    });

  const when = whenLineFor(
    {
      startsAt: new Date(booking.startsAt),
      endsAt: new Date(booking.endsAt),
      isRental: booking.rentalUnitId !== null,
      rangeMode: booking.rangeMode,
    },
    timeZone,
    intlLocale,
  );
  const detail = [
    when,
    `${booking.serviceName}${booking.staffName ? ` · ${booking.staffName}` : ""}`,
    booking.priceCents !== null && booking.currency
      ? formatMoney(booking.priceCents, booking.currency)
      : null,
    booking.note ? `“${booking.note}”` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    // Actions sit inline beside the text on desktop and wrap below it on
    // phones — same stacking rule the other admin list rows follow.
    <li className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{booking.clientName}</p>
        {/* One truncated line; `title` keeps a long note reachable on hover. */}
        <p className="text-muted-foreground truncate text-xs" title={detail}>
          {detail}
        </p>
      </div>
      {/* The list repeats these two buttons per request, so the visible word
          alone is an ambiguous accessible name — same disambiguation the
          services and staff lists use (`Delete ${service.name}`). */}
      <div className="flex shrink-0 items-center gap-2">
        <Button
          size="sm"
          onClick={accept}
          disabled={pending}
          aria-label={t("requests.acceptFrom", { name: booking.clientName })}
        >
          {t("requests.accept")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDeclining(true)}
          disabled={pending}
          aria-label={t("requests.declineFrom", { name: booking.clientName })}
        >
          {t("requests.decline")}
        </Button>
      </div>
      <DeclineRequestDialog
        bookingId={booking.id}
        open={declining}
        onOpenChange={setDeclining}
      />
    </li>
  );
}

/* Live requests waiting on the owner, above the Overview tiles. Nothing at
   all when there are none — an empty box every day would be worse than the
   silence (spec §4). */
export function RequestsInbox({
  requests,
  timeZone,
}: {
  requests: AdminBooking[];
  timeZone: string;
}) {
  const t = useTranslations("bookings");
  if (requests.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-medium">{t("requests.title")}</h2>
        <span className="text-muted-foreground text-xs">{requests.length}</span>
      </div>
      <ul className="bg-card divide-y rounded-xl border">
        {requests.map((b) => (
          <RequestRow key={b.id} booking={b} timeZone={timeZone} />
        ))}
      </ul>
    </section>
  );
}
