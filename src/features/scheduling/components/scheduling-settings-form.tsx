"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { updateSchedulingSettings } from "@/features/scheduling/actions";
import { normalizeHandle } from "@/features/scheduling/handle";
import type { getSchedulingSettings } from "@/features/orgs/queries";
import { bookingUrl, hostLabel } from "@/lib/booking/url";
import { CURRENCIES } from "@/lib/money";
import { LOCALES, LOCALE_NAMES, type Locale } from "@/i18n/config";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { SettingsCard, SettingsRow } from "@/components/settings-row";
import { ConfirmDialog } from "@/features/booking-page/studio/confirm-dialog";

type SchedulingSettings = NonNullable<Awaited<ReturnType<typeof getSchedulingSettings>>>;

const TIMEZONES = Intl.supportedValuesOf("timeZone");

/* Booking page address + timezone. One card, explicit Save (the handle is
   validated server-side and can collide), Save only lights up when dirty.
   The public URL is the field itself — host prefix + handle — with a copy
   button once a handle is saved, instead of a separate read-only block. */
export function SchedulingSettingsForm({
  settings,
  appUrl,
  onHandleInput,
}: {
  settings: SchedulingSettings;
  appUrl: string;
  // Typed (unsaved) handle, so a page-level preview can show the URL live.
  onHandleInput?: (handle: string) => void;
}) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const [handle, setHandle] = React.useState(settings.handle ?? "");
  // Always the stored timezone. Seeding from the browser when no handle was
  // set yet made ANY save (even a handle-only one) silently move the org's
  // timezone — and with it every availability window — to wherever the
  // admin happened to be sitting.
  const [timezone, setTimezone] = React.useState(settings.timezone);
  const [currency, setCurrency] = React.useState(settings.currency);
  const [locale, setLocale] = React.useState<Locale>(settings.locale);
  const [saved, setSaved] = React.useState({
    handle: settings.handle ?? "",
    timezone: settings.timezone,
    currency: settings.currency,
    locale: settings.locale,
  });
  const [pending, startTransition] = React.useTransition();
  const [copied, setCopied] = React.useState(false);
  const [confirmingChange, setConfirmingChange] = React.useState(false);

  const dirty =
    handle !== saved.handle || timezone !== saved.timezone || currency !== saved.currency || locale !== saved.locale;
  // A handle that is already out in the world (saved, non-empty) is about to
  // change or go away: the old link and any embed snippet die with it.
  const handleChanging = saved.handle !== "" && handle !== saved.handle;
  const hostPrefix = `${hostLabel(appUrl)}/`;

  const save = () => {
    setConfirmingChange(false);
    startTransition(async () => {
      const result = await updateSchedulingSettings({ handle, timezone, currency, locale });
      if (!result.ok) toast.error(result.error);
      else {
        toast.success(t("bookingPage.saved"));
        setSaved({ handle, timezone, currency, locale });
      }
    });
  };
  const onSaveClick = () => (handleChanging ? setConfirmingChange(true) : save());

  // Awaited: a refused clipboard write must not flip the icon to a tick
  // (portal-links-panel.tsx precedent).
  const copyLink = async () => {
    if (!saved.handle) return;
    try {
      await navigator.clipboard.writeText(bookingUrl(appUrl, saved.handle));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("copyRefused"));
    }
  };

  return (
    <SettingsCard
      title={t("bookingPage.title")}
      description={t("bookingPage.description")}
      footer={
        <>
          {dirty ? <span className="text-muted-foreground mr-auto text-xs">{tc("unsavedChanges")}</span> : null}
          <Button size="sm" onClick={onSaveClick} disabled={pending || !dirty}>
            {pending ? tc("saving") : tc("save")}
          </Button>
          <ConfirmDialog
            open={confirmingChange}
            title={handle === "" ? t("bookingPage.unpublishTitle") : t("bookingPage.changeTitle")}
            description={t("bookingPage.changeDescription")}
            confirmLabel={handle === "" ? t("bookingPage.unpublish") : t("bookingPage.changeAddress")}
            destructive
            onConfirm={save}
            onClose={() => setConfirmingChange(false)}
          />
        </>
      }
    >
      <SettingsRow label={t("bookingPage.handle")} htmlFor="scheduling-handle" hint={t("bookingPage.handleHint")}>
        <InputGroup>
          <InputGroupAddon>
            <InputGroupText className="font-mono text-xs">{hostPrefix}</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            id="scheduling-handle"
            value={handle}
            onChange={(e) => {
              // Same live normaliser as the claim bar and onboarding: what
              // you can type is always a legal prefix of a handle.
              const next = normalizeHandle(e.target.value);
              setHandle(next);
              onHandleInput?.(next);
            }}
            disabled={pending}
            placeholder={t("bookingPage.handlePlaceholder")}
            className="font-mono text-xs"
          />
          {saved.handle && handle === saved.handle ? (
            <InputGroupAddon align="inline-end">
              <InputGroupButton aria-label={t("bookingPage.copyLinkLabel")} title={tc("copyLink")} onClick={copyLink}>
                <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} size={14} />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
      </SettingsRow>
      <SettingsRow label={t("bookingPage.timezone")} htmlFor="scheduling-timezone" hint={t("bookingPage.timezoneHint")}>
        <select
          id="scheduling-timezone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          disabled={pending}
          className="border-input h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </SettingsRow>
      <SettingsRow label={t("bookingPage.currency")} htmlFor="scheduling-currency" hint={t("bookingPage.currencyHint")}>
        <select
          id="scheduling-currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          disabled={pending}
          className="border-input h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </SettingsRow>
      <SettingsRow label={t("bookingPage.language")} htmlFor="scheduling-locale" hint={t("bookingPage.languageHint")}>
        {/* LOCALE_NAMES: each language named in itself, never translated. */}
        <select
          id="scheduling-locale"
          value={locale}
          onChange={(e) => setLocale(e.target.value as Locale)}
          disabled={pending}
          className="border-input h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_NAMES[l]}
            </option>
          ))}
        </select>
      </SettingsRow>
    </SettingsCard>
  );
}
