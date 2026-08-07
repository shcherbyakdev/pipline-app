"use client";

import { useActionState } from "react";
import { createOrg } from "@/features/orgs/actions";
import type { OrgState } from "@/features/orgs/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: OrgState = {};

export function OnboardingForm() {
  const [state, action, pending] = useActionState(createOrg, initial);

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Organization name</Label>
        <Input id="name" name="name" required placeholder="Acme Signage Co." />
      </div>
      {state.error ? (
        <p className="text-destructive text-sm">{state.error}</p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create organization"}
      </Button>
    </form>
  );
}
