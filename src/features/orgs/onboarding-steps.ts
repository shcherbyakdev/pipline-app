import type { OrgMode } from "./mode";

/* The onboarding wizard's post-org steps (the create-workspace screen
   before them lives in onboarding-form.tsx and carries no dots — the
   stepper begins where skipping does). Mode opens every flow (orgs are
   created as appointments by default; this step is where that changes);
   after it the dots follow the org's mode: service and hours are
   appointment concerns, space is a spaces concern, share closes every
   flow. Every step here is skippable — the welcome checklist on /bookings
   catches whatever was skipped, so no progress is stored anywhere. */

export const WIZARD_STEPS = ["mode", "service", "space", "hours", "share"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export function wizardSteps(mode: OrgMode): WizardStep[] {
  const steps: WizardStep[] = ["mode"];
  if (mode.offersAppointments) steps.push("service");
  if (mode.offersRentals) steps.push("space");
  if (mode.offersAppointments) steps.push("hours");
  steps.push("share");
  return steps;
}

/** The step the URL names, or null for anything unknown or not in this
    org's flow (a spaces-only org's ?step=service is a stale link, not an
    error — the caller falls back to /bookings). */
export function parseWizardStep(raw: unknown, steps: WizardStep[]): WizardStep | null {
  return typeof raw === "string" && (steps as string[]).includes(raw) ? (raw as WizardStep) : null;
}

export function stepHref(step: WizardStep): string {
  return `/onboarding?step=${step}`;
}

/** Where a step's Continue/Skip goes: the next step's URL, or /bookings
    after the last one. */
export function nextStepHref(step: WizardStep, steps: WizardStep[]): string {
  const next = steps[steps.indexOf(step) + 1];
  return next ? stepHref(next) : "/bookings";
}
