"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogSelect } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { disconnectCalendar, setConnectionCalendars, setConnectionStaff, setConnectionSwitches } from "../actions";
import type { Connection } from "../connections";
import { ConnectLink } from "./connect-link";

/* One connected Google account (spec 2026-09-05 §5 "Page"): the account,
   who it belongs to (shown only when it can matter), where bookings go,
   which calendars block time, and Disconnect. Every control autosaves
   (the row-switch idiom: optimistic, snaps back and toasts on failure). */
export function ConnectionRow({
  connection,
  staff,
  showStaff,
}: {
  connection: Connection;
  staff: { id: string; name: string }[];
  showStaff: boolean;
}) {
  const t = useTranslations("integrations.google");
  const tc = useTranslations("common");
  const router = useRouter();
  const id = React.useId();
  const [, startTransition] = React.useTransition();
  const [shown, setShown] = React.useOptimistic(connection);
  const [confirming, setConfirming] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);

  const saveCalendars = (next: { pushCalendarId: string | null; busyCalendarIds: string[] }) => {
    startTransition(async () => {
      setShown({ ...shown, ...next });
      const result = await setConnectionCalendars({ connectionId: connection.id, ...next });
      if (!result.ok) toast.error(result.error);
    });
  };
  const saveStaff = (staffId: string | null) => {
    startTransition(async () => {
      setShown({ ...shown, staffId });
      const result = await setConnectionStaff({ connectionId: connection.id, staffId });
      if (!result.ok) toast.error(result.error);
    });
  };
  const saveSwitches = (next: Partial<Pick<Connection, "inviteClients" | "cancelOnDelete" | "rescheduleOnMove">>) => {
    startTransition(async () => {
      const merged = { ...shown, ...next };
      setShown(merged);
      const result = await setConnectionSwitches({
        connectionId: connection.id,
        inviteClients: merged.inviteClients,
        cancelOnDelete: merged.cancelOnDelete,
        rescheduleOnMove: merged.rescheduleOnMove,
      });
      if (!result.ok) toast.error(result.error);
    });
  };
  const disconnect = () => {
    setRemoving(true);
    startTransition(async () => {
      const result = await disconnectCalendar({ connectionId: connection.id });
      if (!result.ok) {
        setRemoving(false);
        setConfirming(false);
        toast.error(result.error);
        return;
      }
      toast.success(t("disconnected"));
      router.refresh();
    });
  };

  const writable = shown.calendars.filter((c) => c.canWrite);
  const needsReconnect = shown.status === "needs_reconnect";

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <p className="truncate text-xs font-medium">{shown.accountEmail}</p>
          <p className={cn("text-[11px] leading-4", needsReconnect ? "text-destructive" : "text-muted-foreground")}>
            {needsReconnect ? t("needsReconnect") : t("connected")}
          </p>
        </div>
        {needsReconnect ? <ConnectLink label={t("reconnect")} variant="outline" /> : null}
      </div>

      {showStaff ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-staff`} className="text-xs font-medium">
            {t("belongsTo")}
          </label>
          <DialogSelect id={`${id}-staff`} value={shown.staffId ?? ""} onChange={(e) => saveStaff(e.target.value || null)}>
            <option value="">{t("shared")}</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </DialogSelect>
          <p className="text-muted-foreground text-[11px] leading-4">{shown.staffId ? t("belongsToPersonHint") : t("belongsToSharedHint")}</p>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-push`} className="text-xs font-medium">
          {t("addTo")}
        </label>
        <DialogSelect
          id={`${id}-push`}
          value={shown.pushCalendarId ?? ""}
          onChange={(e) => saveCalendars({ pushCalendarId: e.target.value || null, busyCalendarIds: shown.busyCalendarIds })}
        >
          <option value="">{t("dontAdd")}</option>
          {writable.map((c) => (
            <option key={c.id} value={c.id}>
              {c.summary}
            </option>
          ))}
        </DialogSelect>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-xs font-medium">{t("blockFrom")}</legend>
        {shown.calendars.map((c) => {
          const checked = shown.busyCalendarIds.includes(c.id);
          return (
            <label key={c.id} className="flex cursor-pointer items-center gap-2 text-xs">
              <Checkbox
                checked={checked}
                onCheckedChange={(next) =>
                  saveCalendars({
                    pushCalendarId: shown.pushCalendarId,
                    busyCalendarIds: next ? [...shown.busyCalendarIds, c.id] : shown.busyCalendarIds.filter((x) => x !== c.id),
                  })
                }
              />
              <span className="truncate">{c.summary}</span>
            </label>
          );
        })}
        <p className="text-muted-foreground text-[11px] leading-4">{t("blockFromHint")}</p>
      </fieldset>

      <div className="flex flex-col gap-2 border-t pt-3">
        <SwitchRow id={`${id}-invite`} label={t("inviteClients")} hint={t("inviteClientsHint")} checked={shown.inviteClients} onChange={(v) => saveSwitches({ inviteClients: v })} />
        <SwitchRow id={`${id}-cancel`} label={t("cancelOnDelete")} checked={shown.cancelOnDelete} onChange={(v) => saveSwitches({ cancelOnDelete: v })} />
        <SwitchRow id={`${id}-move`} label={t("rescheduleOnMove")} checked={shown.rescheduleOnMove} onChange={(v) => saveSwitches({ rescheduleOnMove: v })} />
        <p className="text-muted-foreground text-[11px] leading-4">
          {t("inboundHint")} {shown.cancelOnDelete || shown.rescheduleOnMove ? (shown.watch ? t("watching") : t("polling")) : null}
        </p>
        {shown.inboundNotice ? <InboundNotice notice={shown.inboundNotice} /> : null}
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <p className="text-muted-foreground text-[11px] leading-4">{t("disconnectNote")}</p>
        {confirming ? (
          <div className="flex items-center gap-1.5">
            <Button size="xs" variant="destructive" onClick={disconnect} disabled={removing}>
              {removing ? tc("deleting") : t("disconnectConfirm")}
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setConfirming(false)} disabled={removing}>
              {t("keep")}
            </Button>
          </div>
        ) : (
          <Button size="xs" variant="ghost" className="text-destructive" onClick={() => setConfirming(true)}>
            {t("disconnect")}
          </Button>
        )}
      </div>
    </div>
  );
}

function SwitchRow({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col">
        <label htmlFor={id} className="text-xs font-medium">
          {label}
        </label>
        {hint ? <p className="text-muted-foreground text-[11px] leading-4">{hint}</p> : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/** `reason:client` as inbound.ts writes it; the reason maps to the same
    line the refusal push uses. */
function InboundNotice({ notice }: { notice: string }) {
  const t = useTranslations("integrations.google");
  const tr = useTranslations("emails.push.calendarReason");
  const [reason, client] = notice.split(":");
  const key = (["slotTaken", "spaces", "notFound", "failed"] as const).find((k) => k === reason) ?? "failed";
  return <p className="text-destructive text-[11px] leading-4">{t("inboundNotice", { client, reason: tr(key) })}</p>;
}
