"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { updatePassword } from "@/features/auth/actions";
import type { AuthState } from "@/features/auth/schema";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/shared/password-input";

const initial: AuthState = {};

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, initial);
  const t = useTranslations("auth");

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">{t("reset.newPassword")}</Label>
        <PasswordInput
          id="password"
          name="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="h-11 rounded-xl"
        />
        <p className="text-muted-foreground text-xs">{t("passwordHint")}</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm">{t("reset.confirm")}</Label>
        <PasswordInput
          id="confirm"
          name="confirm"
          required
          minLength={8}
          autoComplete="new-password"
          className="h-11 rounded-xl"
        />
      </div>
      {state.error ? (
        <p className="text-destructive text-sm">{state.error}</p>
      ) : null}
      <Button type="submit" disabled={pending} className="h-11">
        {pending ? t("reset.saving") : t("reset.submit")}
      </Button>
    </form>
  );
}
