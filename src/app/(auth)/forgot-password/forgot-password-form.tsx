"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { requestPasswordReset } from "@/features/auth/actions";
import type { AuthState } from "@/features/auth/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: AuthState = {};

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, initial);
  const t = useTranslations("auth");

  if (state.sent) {
    return (
      <p className="text-center text-sm">{t("forgot.sent")}</p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder={t("emailPlaceholder")}
          className="h-11 rounded-xl"
        />
      </div>
      {state.error ? (
        <p className="text-destructive text-sm">{state.error}</p>
      ) : null}
      <Button type="submit" disabled={pending} className="h-11">
        {pending ? t("forgot.sending") : t("forgot.submit")}
      </Button>
    </form>
  );
}
