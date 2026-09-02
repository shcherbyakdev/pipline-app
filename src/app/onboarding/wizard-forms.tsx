"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { createService, setWeeklyHours } from "@/features/scheduling/actions";
import { createOffering } from "@/features/rentals/actions";
import { updateOrgModes } from "@/features/orgs/actions";
import { modeToFlags, type OrgModeChoice } from "@/features/orgs/schema";
import { stepHref, wizardSteps } from "@/features/orgs/onboarding-steps";
import { OFFERING_DEFAULTS } from "@/features/rentals/schema";
import type { RangeMode } from "@/features/rentals/range";
import { TIME_OPTIONS, endOptions } from "@/features/scheduling/time-options";
import { INTL_LOCALES, type Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/* The wizard's post-org steps: the same minimal payloads as the booking-page
   starter's first-item forms (studio/first-item-form.tsx — zod fills every
   other default), in the wizard's dark, roomy dress. Every step ends the
   same way: "Not now" is a plain link to `nextHref`, success pushes there. */

const fieldClass = "h-11 rounded-xl";
const selectClass =
  "border-input bg-card h-11 w-full rounded-xl border px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const DURATIONS = [15, 30, 45, 60, 90, 120] as const;

/** The mode cards' message keys (`onboarding.modes.*`), Spaces first (H5b ruling 1). */
const MODE_KEYS: Record<OrgModeChoice, "spaces" | "appointments" | "both"> = {
  rentals: "spaces",
  appointments: "appointments",
  both: "both",
};
const MODE_ORDER: readonly OrgModeChoice[] = ["rentals", "appointments", "both"];

function FormError({ message }: { message: string | null }) {
  return message ? <p role="alert" className="text-destructive text-sm">{message}</p> : null;
}

/** "Not now" (ghost link) + primary, right-aligned like the reference. */
function StepFooter({ nextHref, pending, submitLabel }: { nextHref: string; pending: boolean; submitLabel: string }) {
  const t = useTranslations("onboarding");
  return (
    <div className="mt-3 flex items-center justify-end gap-2">
      <Link
        href={nextHref}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-full px-4 py-2 text-sm outline-none hover:underline focus-visible:ring-2"
      >
        {t("notNow")}
      </Link>
      <Button type="submit" disabled={pending} className="h-11 px-6">
        {submitLabel}
      </Button>
    </div>
  );
}

/* Orgs are created as appointments (orgs/actions.ts); this step is where
   spaces sellers say so — the same label-cards the old pre-org picker used,
   with the current mode preselected. Moving on keeps appointments. A changed
   choice goes through the Settings action (update_org_modes), then straight
   to the chosen flow's first step. */
export function ModeStepForm({ initialMode, nextHref }: { initialMode: OrgModeChoice; nextHref: string }) {
  const t = useTranslations("onboarding");
  const te = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [choice, setChoice] = React.useState<OrgModeChoice>(initialMode);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        if (choice !== initialMode) {
          const result = await updateOrgModes(modeToFlags(choice));
          if (!result.ok) return setError(result.error);
        }
        // The next dot follows the chosen mode, not the mode the page
        // rendered with (steps[0] is this step).
        router.push(stepHref(wizardSteps(modeToFlags(choice))[1]));
      } catch (error) {
        console.error("[onboarding] mode step threw:", error);
        setError(te("generic"));
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      {/* Native radios wrapped in label-cards (house idiom is native form
          controls); the input is visually hidden but stays keyboard/AT
          reachable. */}
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">{t("modeLegend")}</legend>
        {MODE_ORDER.map((value) => {
          const selected = choice === value;
          const key = MODE_KEYS[value];
          return (
            <label
              key={value}
              className={cn(
                "flex cursor-pointer flex-col gap-0.5 rounded-xl border p-3 transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring/50",
                selected ? "border-foreground/40 bg-accent" : "hover:bg-accent/60",
              )}
            >
              <input
                type="radio"
                name="mode"
                value={value}
                className="sr-only"
                checked={selected}
                onChange={() => setChoice(value)}
              />
              <span className="text-sm font-medium">{t(`modes.${key}.title`)}</span>
              <span className="text-muted-foreground text-sm">{t(`modes.${key}.blurb`)}</span>
            </label>
          );
        })}
      </fieldset>
      <FormError message={error} />
      <StepFooter nextHref={nextHref} pending={pending} submitLabel={t("next")} />
    </form>
  );
}

export function ServiceStepForm({ currency, nextHref }: { currency: string; nextHref: string }) {
  const t = useTranslations("onboarding");
  const te = useTranslations("errors");
  const tu = useTranslations("public.units");
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "").trim();
    if (name === "") return;
    const priceLabel = String(fd.get("priceLabel") ?? "").trim();
    const payload = { name, durationMin: Number(fd.get("durationMin")), priceLabel: priceLabel === "" ? undefined : priceLabel };
    setError(null);
    startTransition(async () => {
      try {
        const result = await createService(payload);
        if (!result.ok) return setError(result.error);
        router.push(nextHref);
      } catch (error) {
        console.error("[onboarding] first service threw:", error);
        setError(te("generic"));
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="service-name">{t("wizard.service.name")}</Label>
        <Input id="service-name" name="name" required maxLength={200} placeholder={t("wizard.service.namePlaceholder")} className={fieldClass} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="service-duration">{t("wizard.service.duration")}</Label>
          <select id="service-duration" name="durationMin" defaultValue={60} className={selectClass}>
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {tu("minutes", { count: d })}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="service-price">{t("wizard.service.price")}</Label>
          <Input id="service-price" name="priceLabel" maxLength={100} placeholder={t("wizard.service.pricePlaceholder", { currency })} className={fieldClass} />
        </div>
      </div>
      <FormError message={error} />
      <StepFooter nextHref={nextHref} pending={pending} submitLabel={t("next")} />
    </form>
  );
}

const SPACE_MODES: ReadonlyArray<{ value: RangeMode; label: "byHour" | "byNight" | "byDay" }> = [
  { value: "hours", label: "byHour" },
  { value: "nights", label: "byNight" },
  { value: "days", label: "byDay" },
];

export function SpaceStepForm({ currency, nextHref }: { currency: string; nextHref: string }) {
  const t = useTranslations("onboarding");
  const te = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  // A notice means the space saved but its first unit did not (plan cap):
  // still not bookable, so hold the step instead of advancing silently
  // (first-item-form precedent).
  const [notice, setNotice] = React.useState<string | null>(null);
  const [rangeMode, setRangeMode] = React.useState<RangeMode>("hours");

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "").trim();
    if (name === "") return;
    const price = String(fd.get("price") ?? "").trim();
    const priceCents = price === "" ? null : Math.round(Number(price) * 100);
    const payload =
      rangeMode === "hours"
        ? { name, rangeMode: "hours" as const, ...OFFERING_DEFAULTS.hours, priceCents }
        : { name, rangeMode, ...OFFERING_DEFAULTS.stay, priceCents };
    setError(null);
    startTransition(async () => {
      try {
        const result = await createOffering(payload);
        if (!result.ok) return setError(result.error);
        if (result.notice) return setNotice(result.notice);
        router.push(nextHref);
      } catch (error) {
        console.error("[onboarding] first space threw:", error);
        setError(te("generic"));
      }
    });
  };

  if (notice) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{notice}</p>
        <p className="text-muted-foreground text-sm">{t("wizard.space.noticeHint")}</p>
        <div className="mt-3 flex justify-end">
          <Button type="button" onClick={() => router.push(nextHref)} className="h-11 px-6">
            {t("next")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="space-name">{t("wizard.space.name")}</Label>
        <Input id="space-name" name="name" required maxLength={200} placeholder={t("wizard.space.namePlaceholder")} className={fieldClass} />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">{t("wizard.space.bookedBy")}</legend>
        <div className="grid grid-cols-3 gap-2">
          {SPACE_MODES.map((m) => {
            const selected = rangeMode === m.value;
            return (
              <label
                key={m.value}
                className={cn(
                  "flex cursor-pointer items-center justify-center rounded-xl border p-2.5 text-sm transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring/50",
                  selected ? "border-foreground/40 bg-accent font-medium" : "hover:bg-accent/60",
                )}
              >
                <input type="radio" name="rangeMode" value={m.value} className="sr-only" checked={selected} onChange={() => setRangeMode(m.value)} />
                {t(`wizard.space.${m.label}`)}
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="flex flex-col gap-2">
        <Label htmlFor="space-price">{t("wizard.space.price", { per: rangeMode, currency })}</Label>
        <Input id="space-price" name="price" type="number" min={0} step="0.01" inputMode="decimal" className={fieldClass} />
      </div>
      <FormError message={error} />
      <StepFooter nextHref={nextHref} pending={pending} submitLabel={t("next")} />
    </form>
  );
}

/** Monday-first, like the availability editor's WEEKDAY_ORDER (weekday 0 is
    Sunday — availability_rules convention). Plain 24h times, the
    DEFAULT_WEEK_LABEL precedent: locale formatting here would risk a
    hydration mismatch. */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** Day names from Intl on the pinned locale (INTL_LOCALES — the same tag on
    the server and the client, so hydration agrees). 2024-01-07 is a Sunday. */
function dayLabels(locale: Locale): string[] {
  const fmt = new Intl.DateTimeFormat(INTL_LOCALES[locale], { weekday: "long", timeZone: "UTC" });
  return [0, 1, 2, 3, 4, 5, 6].map((d) => {
    const name = fmt.format(new Date(Date.UTC(2024, 0, 7 + d)));
    return name.charAt(0).toUpperCase() + name.slice(1);
  });
}

type DayState = { on: boolean; startTime: string; endTime: string };

export function HoursStepForm({
  staffId,
  initialDays,
  nextHref,
}: {
  staffId: string;
  initialDays: ReadonlyArray<{ weekday: number; startTime: string; endTime: string }>;
  nextHref: string;
}) {
  const t = useTranslations("onboarding.wizard.hours");
  const te = useTranslations("errors");
  const locale = useLocale() as Locale;
  const labels = React.useMemo(() => dayLabels(locale), [locale]);
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [days, setDays] = React.useState<Record<number, DayState>>(() => {
    const out: Record<number, DayState> = {};
    for (const weekday of WEEKDAY_ORDER) {
      const row = initialDays.find((d) => d.weekday === weekday);
      out[weekday] = row ? { on: true, startTime: row.startTime, endTime: row.endTime } : { on: false, startTime: "09:00", endTime: "17:00" };
    }
    return out;
  });
  const patch = (weekday: number, change: Partial<DayState>) =>
    setDays((prev) => ({ ...prev, [weekday]: { ...prev[weekday], ...change } }));
  const onDays = WEEKDAY_ORDER.filter((w) => days[w].on);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const result = await setWeeklyHours({
          staffId,
          days: onDays.map((w) => ({ weekday: w, startTime: days[w].startTime, endTime: days[w].endTime })),
        });
        if (!result.ok) return setError(result.error);
        router.push(nextHref);
      } catch (error) {
        console.error("[onboarding] weekly hours threw:", error);
        setError(te("generic"));
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        {WEEKDAY_ORDER.map((weekday) => {
          const day = days[weekday];
          return (
            <div key={weekday} className="flex h-11 items-center gap-3">
              <label className="flex min-w-28 items-center gap-2.5 text-sm">
                <Checkbox checked={day.on} onCheckedChange={(v) => patch(weekday, { on: v === true })} />
                {labels[weekday]}
              </label>
              <div className={cn("ml-auto flex items-center gap-1.5", !day.on && "invisible")}>
                <select
                  aria-label={t("startFor", { day: labels[weekday] })}
                  value={day.startTime}
                  onChange={(e) => {
                    // Keep the pair ordered: a start pushed past the end drags the end along.
                    const startTime = e.target.value;
                    patch(weekday, { startTime, endTime: day.endTime > startTime ? day.endTime : endOptions(startTime)[0] });
                  }}
                  className="border-input bg-card h-8 rounded-lg border px-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {TIME_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <span className="text-muted-foreground text-xs">–</span>
                <select
                  aria-label={t("endFor", { day: labels[weekday] })}
                  value={day.endTime}
                  onChange={(e) => patch(weekday, { endTime: e.target.value })}
                  className="border-input bg-card h-8 rounded-lg border px-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {endOptions(day.startTime).map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          );
        })}
      </div>
      <FormError message={error} />
      <StepFooter nextHref={nextHref} pending={pending || onDays.length === 0} submitLabel={t("save")} />
    </form>
  );
}

export function CopyLinkButton({ url }: { url: string }) {
  const t = useTranslations("common");
  const [copied, setCopied] = React.useState(false);
  // Awaited: a refused clipboard write must not flip to "Copied"
  // (welcome-banner.tsx precedent). On refusal the visible mono URL is the
  // fallback — select and copy by hand.
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the link is printed right above the button */
    }
  };
  return (
    <Button type="button" variant="outline" onClick={copy} className="h-11 px-6">
      <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} size={14} />
      {copied ? t("linkCopied") : t("copyLink")}
    </Button>
  );
}
