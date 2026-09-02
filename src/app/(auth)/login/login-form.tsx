"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { sendMagicLink, signInWithPassword } from "@/features/auth/actions";
import type { AuthState } from "@/features/auth/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/shared/password-input";

const initial: AuthState = {};

export function LoginForm({ next = null }: { next?: string | null }) {
  const [mode, setMode] = useState<"password" | "magic">("password");
  return mode === "password" ? (
    <PasswordForm onSwitch={() => setMode("magic")} next={next} />
  ) : (
    <MagicLinkForm onSwitch={() => setMode("password")} />
  );
}

function PasswordForm({ onSwitch, next }: { onSwitch: () => void; next: string | null }) {
  const [state, action, pending] = useActionState(signInWithPassword, initial);
  const t = useTranslations("auth");

  return (
    <form action={action} className="flex flex-col gap-4">
      {/* Validated again server-side (afterLogin) — this is only a carrier. */}
      {next ? <input type="hidden" name="next" value={next} /> : null}
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
        <div className="flex items-center justify-between">
          <Label htmlFor="password">{t("password")}</Label>
          <Link
            href="/forgot-password"
            className="text-muted-foreground text-xs hover:underline"
          >
            {t("login.forgot")}
          </Link>
        </div>
        <PasswordInput
          id="password"
          name="password"
          required
          autoComplete="current-password"
          className="h-11 rounded-xl"
        />
      </div>
      {state.error ? (
        <p className="text-destructive text-sm">{state.error}</p>
      ) : null}
      <Button type="submit" disabled={pending} className="h-11">
        {pending ? t("login.submitting") : t("login.submit")}
      </Button>
      <Button type="button" variant="outline" onClick={onSwitch} className="h-11">
        {t("login.useMagic")}
      </Button>
    </form>
  );
}

function MagicLinkForm({ onSwitch }: { onSwitch: () => void }) {
  const [state, action, pending] = useActionState(sendMagicLink, initial);
  const t = useTranslations("auth");

  if (state.sent) {
    return (
      <p className="text-center text-sm">{t("login.magicSent")}</p>
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
        {pending ? t("login.sending") : t("login.sendMagic")}
      </Button>
      <Button type="button" variant="outline" onClick={onSwitch} className="h-11">
        {t("login.usePassword")}
      </Button>
    </form>
  );
}
