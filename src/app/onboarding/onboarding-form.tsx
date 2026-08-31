"use client";

import * as React from "react";
import { useActionState } from "react";
import { createOrgWithPage } from "@/features/orgs/actions";
import type { OrgState } from "@/features/orgs/schema";
import { HANDLE_RE, isReservedHandle, normalizeHandle, toDisplayName } from "@/features/scheduling/handle";
import { useHandleCheck } from "@/features/scheduling/use-handle-check";
import { ONBOARDING } from "@/features/marketing/site";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";

const initial: OrgState = {};
const TIMEZONES = Intl.supportedValuesOf("timeZone");

// Browser-only value with a fixed placeholder until mount: useSyncExternalStore
// is the idiomatic tool for this (no subscription needed — the store never
// changes — so subscribe is a no-op), not an effect. getServerSnapshot keeps
// SSR and the client's first paint both "UTC" (no hydration mismatch); the
// real snapshot below is a pure read, so no setState-in-effect either.
const subscribeNoop = () => () => {};
const getBrowserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const getServerTimeZone = () => "UTC";

/* One screen: name, page address, timezone → Create workspace. The mode
   choice lives in the wizard that follows (appointments preselected there),
   so this screen carries no dots — the stepper begins where skipping does. */
export function OnboardingForm({ initialHandle, host }: { initialHandle: string | null; host: string }) {
  const [state, action, pending] = useActionState(createOrgWithPage, initial);
  const [name, setName] = React.useState(initialHandle ? toDisplayName(initialHandle) : "");
  const [handle, setHandle] = React.useState(initialHandle ?? "");
  const detectedTimezone = React.useSyncExternalStore(subscribeNoop, getBrowserTimeZone, getServerTimeZone);
  // null until the user picks one; the detected zone is the default until then.
  const [timezone, setTimezone] = React.useState<string | null>(null);
  const effectiveTimezone = timezone ?? detectedTimezone;

  const { result } = useHandleCheck(handle);
  const url = `${host}/${handle || ONBOARDING.handlePlaceholder}`;

  // Silent under the field by default (the reference shows nothing there) —
  // the line appears only for problems: malformed, taken, reserved, or a
  // failed check. The rules copy doubles as the malformed-input error.
  let status: React.ReactNode = null;
  let tone = "text-destructive";
  if (handle && !HANDLE_RE.test(handle)) {
    status = ONBOARDING.handleHint;
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
  } else if (result?.status === "invalid") {
    status = isReservedHandle(handle) ? ONBOARDING.handleReserved : ONBOARDING.handleHint;
  } else if (result?.status === "error") {
    status = ONBOARDING.handleCheckFailed;
    tone = "text-muted-foreground";
  }

  return (
    // Tight label→field pairs (gap-2), generous separation between groups
    // (gap-6), one extra breath before the CTA — the reference's rhythm.
    <form action={action} className="step-enter flex flex-col gap-6">
      <div className="mb-2 text-center">
        <h1 className="text-xl font-semibold tracking-tight">{ONBOARDING.heading}</h1>
        <p className="text-muted-foreground mt-1.5 text-sm text-pretty">{ONBOARDING.sub}</p>
      </div>
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
          className="h-11 rounded-xl"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="handle">{ONBOARDING.handleLabel}</Label>
        {/* The host lives in a filled segment with its own divider (the
            reference's URL field), not as loose inline text. */}
        <InputGroup className="h-11 overflow-clip rounded-xl">
          <InputGroupAddon className="bg-muted h-full self-stretch border-r px-3">
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
            className="h-full pl-3! font-mono text-xs"
          />
        </InputGroup>
        {/* Persistent node so aria-describedby always resolves; empty it
            leaves the flow so the group's height matches its siblings. */}
        <p id="handle-status" aria-live="polite" className={`empty:hidden text-xs ${tone}`}>
          {status}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="timezone">{ONBOARDING.timezoneLabel}</Label>
        <select
          id="timezone"
          name="timezone"
          value={effectiveTimezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="border-input bg-card h-11 w-full rounded-xl border px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </div>
      {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
      <Button type="submit" disabled={pending} className="mt-3 h-11">
        {pending ? ONBOARDING.submitting : ONBOARDING.submit}
      </Button>
    </form>
  );
}
