"use client";

import * as React from "react";
import { useActionState } from "react";
import { createOrgWithPage } from "@/features/orgs/actions";
import type { OrgState } from "@/features/orgs/schema";
import { HANDLE_RE, normalizeHandle, toDisplayName } from "@/features/scheduling/handle";
import { useHandleCheck } from "@/features/scheduling/use-handle-check";
import { ONBOARDING } from "@/features/marketing/site";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";

const initial: OrgState = {};
const TIMEZONES = Intl.supportedValuesOf("timeZone");

export function OnboardingForm({ initialHandle, host }: { initialHandle: string | null; host: string }) {
  const [state, action, pending] = useActionState(createOrgWithPage, initial);
  const [name, setName] = React.useState(initialHandle ? toDisplayName(initialHandle) : "");
  const [handle, setHandle] = React.useState(initialHandle ?? "");
  // SSR renders UTC; the browser's zone replaces it after mount (no hydration
  // mismatch). The setState is deferred to a microtask rather than called
  // directly in the effect body — eslint-plugin-react-hooks'
  // set-state-in-effect rule flags a synchronous setState right in an
  // effect, but not one inside a nested callback (mirrors the debounce
  // callback in useHandleCheck).
  const [timezone, setTimezone] = React.useState("UTC");
  React.useEffect(() => {
    queueMicrotask(() => setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone));
  }, []);

  const { result, checking } = useHandleCheck(handle);
  const url = `${host}/${handle || ONBOARDING.handlePlaceholder}`;

  let status: React.ReactNode = ONBOARDING.handleHint;
  let tone = "text-muted-foreground";
  if (handle && !HANDLE_RE.test(handle)) {
    status = ONBOARDING.handleHint;
    tone = "text-destructive";
  } else if (checking) {
    status = ONBOARDING.handleChecking;
  } else if (result?.status === "free") {
    status = ONBOARDING.handleFree(url);
    tone = "text-foreground";
  } else if (result?.status === "taken") {
    status = (
      <>
        {ONBOARDING.handleTaken(url)}
        {result.suggestion ? (
          <>
            {" — "}
            <button type="button" className="underline" onClick={() => setHandle(result.suggestion!)}>
              {ONBOARDING.handleTakenSuggest(result.suggestion)}
            </button>
          </>
        ) : null}
      </>
    );
    tone = "text-destructive";
  } else if (result?.status === "invalid") {
    tone = "text-destructive";
  } else if (result?.status === "error") {
    status = ONBOARDING.handleCheckFailed;
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">{ONBOARDING.nameLabel}</Label>
        <Input
          id="name"
          name="name"
          required
          minLength={2}
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={ONBOARDING.namePlaceholder}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="handle">{ONBOARDING.handleLabel}</Label>
        <InputGroup>
          <InputGroupAddon>
            <InputGroupText className="font-mono text-xs">{host}/</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            id="handle"
            name="handle"
            value={handle}
            onChange={(e) => setHandle(normalizeHandle(e.target.value))}
            placeholder={ONBOARDING.handlePlaceholder}
            autoComplete="off"
            spellCheck={false}
            aria-describedby="handle-status"
            className="font-mono text-xs"
          />
        </InputGroup>
        <p id="handle-status" aria-live="polite" className={`min-h-4 text-xs ${tone}`}>
          {status}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="timezone">{ONBOARDING.timezoneLabel}</Label>
        <select
          id="timezone"
          name="timezone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </div>
      {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? ONBOARDING.submitting : ONBOARDING.submit}
      </Button>
    </form>
  );
}
