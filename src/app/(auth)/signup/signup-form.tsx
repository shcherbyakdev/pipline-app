"use client";

import { useActionState } from "react";
import { signUp } from "@/features/auth/actions";
import type { AuthState } from "@/features/auth/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: AuthState = {};

export function SignupForm({ handle, host }: { handle: string | null; host: string }) {
  const [state, action, pending] = useActionState(signUp, initial);
  const claimed = handle ? `${host}/${handle}` : null;

  if (state.sent) {
    return (
      <p className="text-sm">
        {claimed
          ? `Check your email to confirm your account and claim ${claimed}.`
          : "Check your email to confirm your account."}
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      {claimed ? (
        <p className="bg-muted text-muted-foreground rounded-lg px-3 py-2 font-mono text-xs">
          Claiming <span className="text-foreground">{claimed}</span>
        </p>
      ) : null}
      {handle ? <input type="hidden" name="handle" value={handle} /> : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@company.com"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
        <p className="text-muted-foreground text-xs">At least 8 characters.</p>
      </div>
      {state.error ? (
        <p className="text-destructive text-sm">{state.error}</p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
