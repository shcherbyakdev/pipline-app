import { getTranslations } from "next-intl/server";
import { SettingsCard } from "@/components/settings-row";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LEGAL_COUNTRIES } from "../legal";
import { connectStripe, continueOnboarding } from "../actions";
import type { PaymentsPageData } from "../queries";

export async function StripeCard({ data }: { data: PaymentsPageData }) {
  const t = await getTranslations("payments.stripe");
  const caps = (["card_payments", "p24_payments", "blik_payments"] as const).filter((k) => data.account?.capabilities[k] === "active");
  return (
    <SettingsCard title={t("title")} description={t("blurb")}>
      {/* SettingsCard's body has no padding of its own — every child pads
          itself (google-calendar-card.tsx's rule). */}
      {!data.configured ? (
        <p className="text-muted-foreground px-4 py-3 text-sm">{t("notConfigured")}</p>
      ) : !data.account ? (
        <form action={connectStripe} className="flex flex-col gap-3 px-4 py-3">
          <p className="text-muted-foreground text-sm">{t("notConnected")}</p>
          <label className="flex items-center gap-2 text-sm">
            {t("country")}
            <select name="country" defaultValue="PL" className="rounded-md border bg-background px-2 py-1">
              {LEGAL_COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <button type="submit" className={cn(buttonVariants({ variant: "brand", size: "sm" }), "self-start")}>{t("connect")}</button>
        </form>
      ) : data.account.status === "active" ? (
        <div className="flex flex-col gap-2 px-4 py-3">
          <p className="text-sm">{t("active")}</p>
          <div className="flex flex-wrap gap-1.5">{caps.map((k) => <Badge key={k} variant="secondary">{t(`capability.${k}`)}</Badge>)}</div>
          <a href="https://dashboard.stripe.com/" target="_blank" rel="noopener" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "self-start")}>{t("openDashboard")}</a>
        </div>
      ) : (
        <form action={continueOnboarding} className="flex flex-col gap-2 px-4 py-3">
          <p className="text-sm">{data.account.status === "restricted" ? t("restricted") : t("onboarding")}</p>
          <button type="submit" className={cn(buttonVariants({ variant: "brand", size: "sm" }), "self-start")}>{t("continue")}</button>
        </form>
      )}
    </SettingsCard>
  );
}
