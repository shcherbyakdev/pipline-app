import { describe, it, expect } from "vitest";
import { nextStepHref, parseWizardStep, stepHref, wizardSteps } from "./onboarding-steps";

const APPOINTMENTS = { offersAppointments: true, offersRentals: false };
const SPACES = { offersAppointments: false, offersRentals: true };

describe("wizardSteps", () => {
  it("opens with mode, follows the org's mode, share closes every flow", () => {
    expect(wizardSteps(APPOINTMENTS)).toEqual(["mode", "service", "hours", "share"]);
    expect(wizardSteps(SPACES)).toEqual(["mode", "space", "share"]);
  });
});

describe("parseWizardStep", () => {
  const steps = wizardSteps(APPOINTMENTS);
  it("accepts only steps in this org's flow", () => {
    expect(parseWizardStep("mode", steps)).toBe("mode");
    expect(parseWizardStep("hours", steps)).toBe("hours");
    expect(parseWizardStep("space", steps)).toBeNull(); // not an appointments step
    expect(parseWizardStep("nope", steps)).toBeNull();
    expect(parseWizardStep(undefined, steps)).toBeNull();
    expect(parseWizardStep(["service"], steps)).toBeNull();
  });
});

describe("nextStepHref", () => {
  const steps = wizardSteps(APPOINTMENTS);
  it("walks the flow and exits to /bookings", () => {
    expect(nextStepHref("mode", steps)).toBe(stepHref("service"));
    expect(nextStepHref("service", steps)).toBe(stepHref("hours"));
    expect(nextStepHref("hours", steps)).toBe(stepHref("share"));
    expect(nextStepHref("share", steps)).toBe("/bookings");
  });
});
