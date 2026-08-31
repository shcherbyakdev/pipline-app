import { redirect } from "next/navigation";
import { env } from "@/env";
import { getCurrentOrg, requireUser } from "@/lib/auth/session";
import { HANDLE_RE, isReservedHandle } from "@/features/scheduling/handle";
import { ONBOARDING } from "@/features/marketing/site";
import { BookloWordmark } from "@/features/marketing/components/booklo-mark";
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
    // The same seam treatment as (auth)/layout.tsx: the wordmark up top, the
    // form on a white panel. Not that layout itself — this route already has
    // a session and lives outside the (auth) group.
    <main className="flex min-h-full flex-1 flex-col items-center justify-center gap-7 p-6">
      <span aria-hidden="true" className="text-foreground text-[23px]">
        <BookloWordmark />
      </span>
      <div className="bg-card w-full max-w-sm rounded-2xl border p-6 shadow-(--shadow-card) sm:p-7">
        <h1 className="mb-1 text-xl font-semibold tracking-tight">{ONBOARDING.heading}</h1>
        <p className="text-muted-foreground mb-6 text-sm">{ONBOARDING.sub}</p>
        <OnboardingForm initialHandle={claimed} host={hostLabel(env.NEXT_PUBLIC_APP_URL)} />
      </div>
    </main>
  );
}
