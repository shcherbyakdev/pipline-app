"use client";

import { useActionState } from "react";
import { updatePassword } from "@/features/auth/actions";
import type { AuthState } from "@/features/auth/schema";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/shared/password-input";

const initial: AuthState = {};

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, initial);

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">New password</Label>
        <PasswordInput id="password" name="password" required minLength={8} autoComplete="new-password" />
        <p className="text-muted-foreground text-xs">At least 8 characters.</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm">Confirm new password</Label>
        <PasswordInput id="confirm" name="confirm" required minLength={8} autoComplete="new-password" />
      </div>
      {state.error ? (
        <p className="text-destructive text-sm">{state.error}</p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
