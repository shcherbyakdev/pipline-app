import { redirect } from "next/navigation";
import { env } from "@/env";
import { getCurrentOrg, requireUser } from "@/lib/auth/session";
import { HANDLE_RE, isReservedHandle } from "@/features/scheduling/handle";
import { ONBOARDING } from "@/features/marketing/site";
import { hostLabel } from "@/lib/booking/url";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const user = await requireUser();
  const org = await getCurrentOrg();
  if (org) redirect("/bookings"); // already onboarded

  // The landing claim, if any (signUp stored it as metadata). Re-validated:
  // metadata is user-editable and the reserved list may have grown since.
  const raw = user.user_metadata?.claimed_handle;
  const claimed = typeof raw === "string" && HANDLE_RE.test(raw) && !isReservedHandle(raw) ? raw : null;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">{ONBOARDING.heading}</h1>
        <p className="text-muted-foreground mb-6 text-sm">{ONBOARDING.sub}</p>
        <OnboardingForm initialHandle={claimed} host={hostLabel(env.NEXT_PUBLIC_APP_URL)} />
      </div>
    </main>
  );
}
