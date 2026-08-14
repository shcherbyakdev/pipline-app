"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { sendMagicLink, signInWithPassword } from "@/features/auth/actions";
import type { AuthState } from "@/features/auth/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: AuthState = {};

export function LoginForm() {
  const [mode, setMode] = useState<"password" | "magic">("password");
  return mode === "password" ? (
    <PasswordForm onSwitch={() => setMode("magic")} />
  ) : (
    <MagicLinkForm onSwitch={() => setMode("password")} />
  );
}

function PasswordForm({ onSwitch }: { onSwitch: () => void }) {
  const [state, action, pending] = useActionState(signInWithPassword, initial);

  return (
    <form action={action} className="flex flex-col gap-4">
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
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link
            href="/forgot-password"
            className="text-muted-foreground text-xs hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
        />
      </div>
      {state.error ? (
        <p className="text-destructive text-sm">{state.error}</p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <button
        type="button"
        onClick={onSwitch}
        className="text-muted-foreground text-sm hover:underline"
      >
        Email me a magic link instead
      </button>
    </form>
  );
}

function MagicLinkForm({ onSwitch }: { onSwitch: () => void }) {
  const [state, action, pending] = useActionState(sendMagicLink, initial);

  if (state.sent) {
    return (
      <p className="text-sm">Check your email for a magic link to sign in.</p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
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
      {state.error ? (
        <p className="text-destructive text-sm">{state.error}</p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send magic link"}
      </Button>
      <button
        type="button"
        onClick={onSwitch}
        className="text-muted-foreground text-sm hover:underline"
      >
        Sign in with a password instead
      </button>
    </form>
  );
}
