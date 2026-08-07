import { redirect } from "next/navigation";
import { getCurrentOrg, requireUser } from "@/lib/auth/session";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  await requireUser();
  const org = await getCurrentOrg();
  if (org) redirect("/rollouts"); // already onboarded

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">
          Create your organization
        </h1>
        <p className="text-muted-foreground mb-6 text-sm">
          This is your workspace for rollouts, units, and your team.
        </p>
        <OnboardingForm />
      </div>
    </main>
  );
}
