"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ClientContact } from "@/features/orgs/schema";

// Name / contact / Note, shared by the appointment and rental booking forms.
// `contact` (orgs.client_contact, 0086) picks which contact fields show; on
// the public forms they are required, on the admin forms (`optional`) both
// are offered and neither is required — a walk-in may leave no trace.
// Field `name`s stay unprefixed — the enclosing <form> reads them via
// FormData — but `id`s take `idPrefix` so both forms can render on the same
// page (e.g. the widget picker) without colliding label/input pairs.
export function ClientDetailsFields({
  contact = "email",
  optional = false,
  idPrefix = "",
}: {
  contact?: ClientContact;
  optional?: boolean;
  idPrefix?: string;
}) {
  const t = useTranslations("public.details");
  const showEmail = optional || contact !== "phone";
  const showPhone = optional || contact !== "email";
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}name`}>{t("name")}</Label>
        <Input id={`${idPrefix}name`} name="name" required maxLength={200} />
      </div>
      {showEmail ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}email`}>{optional ? t("emailOptional") : t("email")}</Label>
          <Input
            id={`${idPrefix}email`}
            name="email"
            type="email"
            autoComplete="email"
            required={!optional}
            maxLength={320}
          />
        </div>
      ) : null}
      {showPhone ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}phone`}>{optional ? t("phoneOptional") : t("phone")}</Label>
          <Input
            id={`${idPrefix}phone`}
            name="phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            required={!optional}
            maxLength={30}
            // Mirrors optionalPhone (schema.ts): digits plus the separators
            // people type; the RPC normalises to +digits. Escaped for the
            // `v` flag browsers compile `pattern` with (class syntax chars).
            pattern="\+?[0-9][0-9 \(\)\.\/\-]{4,28}"
          />
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}note`}>{t("note")}</Label>
        <Textarea id={`${idPrefix}note`} name="note" maxLength={2000} rows={3} />
      </div>
    </>
  );
}
