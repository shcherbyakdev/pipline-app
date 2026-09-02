"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { signUp } from "@/features/auth/actions";
import type { AuthState } from "@/features/auth/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/shared/password-input";

const initial: AuthState = {};

export function SignupForm({ handle, host }: { handle: string | null; host: string }) {
  const [state, action, pending] = useActionState(signUp, initial);
  const claimed = handle ? `${host}/${handle}` : null;
  const t = useTranslations("auth");

  if (state.sent) {
    return (
      <p className="text-center text-sm">
        {claimed ? t("signup.sentClaimed", { claimed }) : t("signup.sent")}
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      {claimed ? (
        <p className="bg-muted text-muted-foreground rounded-lg px-3 py-2 text-center font-mono text-xs">
          {t.rich("signup.claiming", {
            claimed,
            handle: (chunks) => <span className="text-foreground">{chunks}</span>,
          })}
        </p>
      ) : null}
      {handle ? <input type="hidden" name="handle" value={handle} /> : null}
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
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">{t("password")}</Label>
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
      {state.error ? (
        <p className="text-destructive text-sm">{state.error}</p>
      ) : null}
      <Button type="submit" disabled={pending} className="h-11">
        {pending ? t("signup.submitting") : t("signup.submit")}
      </Button>
    </form>
  );
}
