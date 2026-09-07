"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { SettingsCard, SettingsRow } from "@/components/settings-row";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { HOLD_OPTIONS, type Legal } from "../legal";
import { updatePaymentSettings } from "../actions";

const LEGAL_FIELDS = ["legalName", "address", "taxId", "regNo", "termsUrl", "privacyUrl", "refundUrl"] as const;

/* Hold window + the legal identity the public footer prints (S2): two
   cards, one save — the RPC writes both together (0079's
   update_org_payments), so there is nothing a split save could do that a
   shared one can't. */
export function PaymentSettingsForm({ holdMin, legal }: { holdMin: number; legal: Legal }) {
  const t = useTranslations("payments");
  const tc = useTranslations("common");
  const [hold, setHold] = React.useState(holdMin);
  const [fields, setFields] = React.useState<Record<(typeof LEGAL_FIELDS)[number], string>>(() =>
    Object.fromEntries(LEGAL_FIELDS.map((k) => [k, legal[k] ?? ""])) as Record<(typeof LEGAL_FIELDS)[number], string>,
  );
  const [pending, startTransition] = React.useTransition();

  const save = () => {
    startTransition(async () => {
      const result = await updatePaymentSettings({ holdMin: hold, legal: fields });
      if (!result.ok) toast.error(result.error);
      else toast.success(t("saved"));
    });
  };

  return (
    <>
      <SettingsCard title={t("hold.title")} description={t("hold.blurb")}>
        <SettingsRow label={t("hold.label")} htmlFor="payments-hold">
          <select
            id="payments-hold"
            value={hold}
            onChange={(e) => setHold(Number(e.target.value))}
            disabled={pending}
            className="border-input h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {HOLD_OPTIONS.map((n) => (
              <option key={n} value={n}>{t(`hold.options.${n}`)}</option>
            ))}
          </select>
        </SettingsRow>
      </SettingsCard>
      <SettingsCard
        title={t("legal.title")}
        description={t("legal.blurb")}
        footer={
          <Button size="sm" onClick={save} disabled={pending}>
            {pending ? tc("saving") : t("save")}
          </Button>
        }
      >
        {LEGAL_FIELDS.map((k) => (
          <SettingsRow key={k} label={t(`legal.${k}`)} htmlFor={`payments-legal-${k}`}>
            <Input
              id={`payments-legal-${k}`}
              value={fields[k]}
              onChange={(e) => setFields((f) => ({ ...f, [k]: e.target.value }))}
              disabled={pending}
            />
          </SettingsRow>
        ))}
      </SettingsCard>
    </>
  );
}
