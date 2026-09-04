"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SettingsCard } from "@/components/settings-row";
import { browserLabel } from "../browser-label";
import { removePushSubscription, savePushSubscription, sendTestPush } from "../actions";
import type { PushDevice } from "../queries";

/* The push card (spec 2026-09-05 §6): where this browser stands, the one
   button that changes it, the devices already enabled, and a test. The
   browser is the source of truth for "this device": on mount we ask the
   service worker for its subscription and match its endpoint against the
   rows the server gave us. */

type Status =
  | "checking"
  | "notConfigured"
  | "unsupported"
  | "denied"
  | "enabledHere"
  | "notEnabledHere";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function isIOS(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

/** Where this browser stands. Registers the worker as a side effect (idempotent). */
async function probeDevice(publicKey: string | null, devices: PushDevice[]): Promise<{ status: Status; endpoint: string | null }> {
  if (!publicKey) return { status: "notConfigured", endpoint: null };
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return { status: "unsupported", endpoint: null };
  }
  if (Notification.permission === "denied") return { status: "denied", endpoint: null };
  try {
    await navigator.serviceWorker.register("/sw.js");
    // Wait for the worker to be ACTIVE before offering the button: a
    // subscribe() issued against a still-installing worker was seen to hang
    // in Chrome (QA 2026-09-05), and "Checking…" for a moment costs nothing.
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    const endpoint = sub?.endpoint ?? null;
    const known = endpoint !== null && devices.some((d) => d.endpoint === endpoint);
    return { status: known ? "enabledHere" : "notEnabledHere", endpoint };
  } catch (error) {
    console.error("[notifications] service worker:", error);
    return { status: "unsupported", endpoint: null };
  }
}

export function PushDevices({ publicKey, devices }: { publicKey: string | null; devices: PushDevice[] }) {
  const t = useTranslations("notifications.push");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const [, startTransition] = React.useTransition();
  const [status, setStatus] = React.useState<Status>("checking");
  const [busy, setBusy] = React.useState(false);
  // The endpoint this browser currently holds (null = none).
  const [hereEndpoint, setHereEndpoint] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void probeDevice(publicKey, devices).then((probe) => {
      if (cancelled) return;
      setHereEndpoint(probe.endpoint);
      setStatus(probe.status);
    });
    return () => {
      cancelled = true;
    };
  }, [publicKey, devices]);

  const enable = async () => {
    if (!publicKey) return;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "notEnabledHere");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
      const json = sub.toJSON();
      const keys = json.keys;
      if (!keys?.p256dh || !keys?.auth) throw new Error("subscription without keys");
      const result = await savePushSubscription({ endpoint: sub.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth }, userAgent: navigator.userAgent });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setHereEndpoint(sub.endpoint);
      setStatus("enabledHere");
      startTransition(() => router.refresh());
    } catch (error) {
      console.error("[notifications] enable push:", error);
      toast.error(t("failed"));
    } finally {
      setBusy(false);
    }
  };

  const disableHere = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      const row = devices.find((d) => d.endpoint === (sub?.endpoint ?? hereEndpoint));
      if (sub) await sub.unsubscribe();
      if (row) {
        const result = await removePushSubscription({ id: row.id });
        if (!result.ok) toast.error(result.error);
      }
      setHereEndpoint(null);
      setStatus("notEnabledHere");
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  };

  const remove = (device: PushDevice) => {
    startTransition(async () => {
      const result = await removePushSubscription({ id: device.id });
      if (!result.ok) toast.error(result.error);
      else router.refresh();
    });
  };

  const test = () => {
    startTransition(async () => {
      const result = await sendTestPush();
      if (result.ok) toast.success(t("testSent"));
      else toast.error(t("testFailed"));
    });
  };

  const statusLine =
    status === "checking"
      ? t("status.checking")
      : status === "notConfigured"
        ? t("status.notConfigured")
        : status === "unsupported"
          ? t("status.unsupported")
          : status === "denied"
            ? t("status.denied")
            : status === "enabledHere"
              ? t("status.enabledHere")
              : t("status.notEnabledHere");

  return (
    <SettingsCard title={t("title")} description={t("blurb")}>
      <div className="flex flex-col gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium" aria-live="polite">
            {statusLine}
          </p>
          {status === "enabledHere" ? (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={test} disabled={busy}>
                {t("test")}
              </Button>
              <Button variant="ghost" size="sm" onClick={disableHere} disabled={busy}>
                {t("disableHere")}
              </Button>
            </div>
          ) : status === "notEnabledHere" ? (
            <Button variant="brand" size="sm" onClick={enable} disabled={busy}>
              {busy ? t("enabling") : t("enable")}
            </Button>
          ) : null}
        </div>
        {status === "unsupported" && isIOS() ? <p className="text-muted-foreground text-[11px] leading-4">{t("status.iosHint")}</p> : null}
      </div>
      <div className="flex flex-col gap-1.5 px-4 py-3">
        <p className="text-muted-foreground text-[11px] font-medium">{t("devices")}</p>
        {devices.length === 0 ? (
          <p className="text-muted-foreground text-xs">{t("noDevices")}</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {devices.map((d) => {
              const label = browserLabel(d.userAgent);
              const name = label ? `${label.browser}${label.os ? ` · ${label.os}` : ""}` : t("unknownBrowser");
              const here = d.endpoint === hereEndpoint;
              return (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-xs font-medium">
                      {name}
                      {here ? <span className="text-muted-foreground font-normal"> · {t("thisDevice")}</span> : null}
                    </span>
                    <span className="text-muted-foreground text-[11px]">
                      {t("added", { date: format.dateTime(new Date(d.createdAt), { dateStyle: "medium" }) })}
                    </span>
                  </div>
                  {here ? null : (
                    <Button variant="ghost" size="sm" onClick={() => remove(d)} aria-label={t("removeDevice", { device: name })}>
                      {tCommon("remove")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </SettingsCard>
  );
}
