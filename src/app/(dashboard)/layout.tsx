import { Suspense } from "react";
import { requireOrg } from "@/lib/auth/session";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/shell/app-shell";
import { PlanBannerSlot } from "@/features/billing/components/plan-banner";
import { BILLING_ENABLED } from "@/lib/flags";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { org, user } = await requireOrg();

  return (
    <Providers>
      <AppShell org={org.name} userEmail={user.email ?? ""}>
        {/* Flag checked here as well as inside the slot so the dormant world
            runs exactly the queries it ran before this slice: none. Suspended
            so the billing read never delays the shell — the nudge streams in
            when it is ready, or never, and the page doesn't wait. */}
        {BILLING_ENABLED ? (
          <Suspense fallback={null}>
            <PlanBannerSlot />
          </Suspense>
        ) : null}
        {children}
      </AppShell>
    </Providers>
  );
}
