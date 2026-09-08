"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DecimalInput } from "@/components/ui/decimal-input";
import { Input, nativeSelectClass } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";
import { markBookingPaid } from "@/features/scheduling/booking-actions";
import {
  addBookingCharge,
  deleteBookingCharge,
  loadBookingSettlement,
  sendBalanceLink,
  writeOffBooking,
} from "@/features/payments/actions";
import { CHARGE_KINDS, overtimeCharge, type Charge, type ChargeKind } from "@/features/payments/settlement";

type Settlement = {
  charges: Charge[];
  writtenOffCents: number;
  writtenOffNote: string | null;
  balanceCents: number;
  hourlyRateCents: number | null;
  canCollect: boolean;
};

/* S7: what the session actually cost, once it is over. The block never does
   money arithmetic of its own — every number here is the row's or the
   balance helper's (0082, TS twin in settlement.ts); the one computation is
   the overtime helper, which only PRE-FILLS the add row and is editable
   before it is saved. Reloads after every mutation, so a second tab that
   settled the booking is visible on the next action. */
export function BookingCharges({
  bookingId,
  currency,
  ended,
}: {
  bookingId: string;
  currency: string | null;
  // Past its end time: a zero balance then means "settled", not "nothing
  // has happened yet".
  ended: boolean;
}) {
  const t = useTranslations("bookings.charges");
  // The client-facing money vocabulary, already translated and already
  // carrying the "label × qty — amount" shape (public.units).
  const tUnits = useTranslations("public.units");
  const [data, setData] = React.useState<Settlement | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [confirm, setConfirm] = React.useState<"paid" | "writeOff" | null>(null);
  const [writeOffNote, setWriteOffNote] = React.useState("");

  // An unpriced booking carries no currency; the ledger defaults the same
  // way mark_booking_paid does (coalesce(currency, 'PLN')).
  const cur = currency ?? "PLN";

  const load = React.useCallback(async () => {
    const result = await loadBookingSettlement({ bookingId });
    if (result.ok) {
      setData(result);
      setLoadError(null);
    } else {
      setData(null);
      setLoadError(result.error);
    }
  }, [bookingId]);

  // Wrapped, like every other load in the admin dialogs: the state lands
  // inside the transition, never synchronously in the effect body.
  const refresh = React.useCallback(() => {
    startTransition(async () => {
      await load();
    });
  }, [load]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  // ---- the add row -------------------------------------------------------
  const kindLabel = React.useCallback((k: ChargeKind) => t(`kind.${k}`), [t]);
  const [kind, setKind] = React.useState<ChargeKind>("overtime");
  const [label, setLabel] = React.useState(() => t("kind.overtime"));
  // Once the studio types its own words, changing the kind must not wipe them.
  const [labelEdited, setLabelEdited] = React.useState(false);
  const [qty, setQty] = React.useState(1);
  const [unitMajor, setUnitMajor] = React.useState(0);
  const [note, setNote] = React.useState("");
  const [minutes, setMinutes] = React.useState(30);

  const pickKind = (k: ChargeKind) => {
    setKind(k);
    if (!labelEdited) setLabel(kindLabel(k));
  };

  const add = () =>
    startTransition(async () => {
      const result = await addBookingCharge({
        bookingId,
        kind,
        label: label.trim(),
        qty,
        unitCents: Math.round(unitMajor * 100),
        note: note.trim() === "" ? undefined : note.trim(),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setQty(1);
      setUnitMajor(0);
      setNote("");
      setLabelEdited(false);
      setLabel(kindLabel(kind));
      await load();
    });

  const remove = (id: string) =>
    startTransition(async () => {
      const result = await deleteBookingCharge({ id });
      if (!result.ok) toast.error(result.error);
      await load();
    });

  const fillOvertime = () => {
    if (data?.hourlyRateCents == null) return;
    const c = overtimeCharge(minutes, data.hourlyRateCents);
    setKind("overtime");
    setLabel(kindLabel("overtime"));
    setLabelEdited(false);
    setQty(c.qty);
    setUnitMajor(c.unitCents / 100);
  };

  // ---- settling ----------------------------------------------------------
  const markPaid = () =>
    startTransition(async () => {
      const result = await markBookingPaid({ id: bookingId });
      if (!result.ok) toast.error(result.error);
      else toast.success(t("paid"));
      setConfirm(null);
      await load();
    });

  const sendLink = () =>
    startTransition(async () => {
      const result = await sendBalanceLink({ id: bookingId });
      if (!result.ok) toast.error(result.error);
      else toast.success(t("linkSent"));
      await load();
    });

  const writeOff = () =>
    startTransition(async () => {
      const result = await writeOffBooking({ id: bookingId, note: writeOffNote.trim() === "" ? undefined : writeOffNote.trim() });
      if (!result.ok) toast.error(result.error);
      else toast.success(t("writtenOffDone"));
      setConfirm(null);
      setWriteOffNote("");
      await load();
    });

  if (loadError !== null) {
    return <p className="text-muted-foreground text-xs">{loadError}</p>;
  }
  if (data === null) return null;

  const balanceLine =
    data.balanceCents > 0
      ? t("balanceDue", { amount: formatMoney(data.balanceCents, cur) })
      : data.balanceCents < 0
        ? t("overpaid", { amount: formatMoney(-data.balanceCents, cur) })
        : ended
          ? t("settled")
          : t("nothingDue");

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-input p-3">
      <h3 className="text-sm font-medium">{t("title")}</h3>

      {data.charges.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {data.charges.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <span className="flex-1 text-sm">
                {c.qty > 1
                  ? tUnits("chargeLineQty", { label: c.label, qty: c.qty, amount: formatMoney(c.cents, cur) })
                  : tUnits("chargeLine", { label: c.label, amount: formatMoney(c.cents, cur) })}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0"
                aria-label={t("remove", { label: c.label })}
                onClick={() => remove(c.id)}
                disabled={pending}
              >
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {/* The overtime helper: minutes in, a pre-filled (still editable) add
          row out. Only offered when the booking's own hourly rate is known. */}
      {data.hourlyRateCents !== null ? (
        <div className="flex items-end gap-2">
          <Input
            type="number"
            min={0}
            step={5}
            className="w-24"
            aria-label={t("minutes")}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
          />
          <Button type="button" variant="outline" size="sm" onClick={fillOvertime} disabled={pending || minutes <= 0}>
            {t("addOvertime")}
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[8rem_1fr_4rem_6rem]">
        <select aria-label={t("title")} className={nativeSelectClass} value={kind} onChange={(e) => pickKind(e.target.value as ChargeKind)}>
          {CHARGE_KINDS.map((k) => (
            <option key={k} value={k}>
              {kindLabel(k)}
            </option>
          ))}
        </select>
        <Input
          aria-label={t("label")}
          maxLength={80}
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
            setLabelEdited(true);
          }}
        />
        <Input
          type="number"
          min={1}
          max={99}
          aria-label={t("qty")}
          value={qty}
          onChange={(e) => setQty(Number(e.target.value))}
        />
        <DecimalInput aria-label={t("amount", { currency: cur })} value={unitMajor} onCommit={setUnitMajor} />
      </div>
      <div className="flex items-center gap-2">
        <Input aria-label={t("note")} maxLength={500} placeholder={t("note")} value={note} onChange={(e) => setNote(e.target.value)} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={add}
          disabled={pending || label.trim() === "" || qty < 1}
        >
          {t("add")}
        </Button>
      </div>

      <p className="text-sm">{balanceLine}</p>
      {data.writtenOffCents > 0 ? (
        <p className="text-muted-foreground text-xs">
          {data.writtenOffNote
            ? t("writtenOffNote", { amount: formatMoney(data.writtenOffCents, cur), note: data.writtenOffNote })
            : t("writtenOff", { amount: formatMoney(data.writtenOffCents, cur) })}
        </p>
      ) : null}

      {data.balanceCents > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {confirm === "paid" ? (
            <Button type="button" variant="brand" size="sm" onClick={markPaid} disabled={pending}>
              {t("markPaidConfirm")}
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirm("paid")} disabled={pending}>
              {t("markPaid")}
            </Button>
          )}
          {/* Hidden, not disabled: with no client email or no live payments
              account there is nothing to enable, so the reason stands in
              its place. */}
          {data.canCollect ? (
            <Button type="button" variant="outline" size="sm" onClick={sendLink} disabled={pending}>
              {t("sendLink")}
            </Button>
          ) : (
            <span className="text-muted-foreground text-xs">{t("noEmailOrAccount")}</span>
          )}
          {confirm === "writeOff" ? (
            <>
              <Input
                aria-label={t("note")}
                maxLength={500}
                className="w-40"
                value={writeOffNote}
                onChange={(e) => setWriteOffNote(e.target.value)}
              />
              <Button type="button" variant="destructive" size="sm" onClick={writeOff} disabled={pending}>
                {t("writeOffConfirm")}
              </Button>
            </>
          ) : (
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirm("writeOff")} disabled={pending}>
              {t("writeOff")}
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}
