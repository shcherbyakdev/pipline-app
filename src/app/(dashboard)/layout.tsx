import { Suspense } from "react";
import { requireOrg } from "@/lib/auth/session";
import { getDashboardFlags } from "@/lib/flags/resolve";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/shell/app-shell";
import { PlanBannerSlot } from "@/features/billing/components/plan-banner";
import { modeOf } from "@/features/orgs/mode";
import { countPendingRequests } from "@/features/scheduling/queries";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { org, user } = await requireOrg();
  // Resolved once per request (React cache) and handed down as a prop: the
  // shell is client-rendered and cannot read the DB itself.
  const flags = await getDashboardFlags(org.id);
  const mode = modeOf(org);
  // Badge on the Overview row. Gated on the flag so an opted-out org runs
  // exactly the queries it ran before: none. A decorative badge must never
  // take down the layout, so a query error is swallowed to 0.
  const pendingRequests = flags.overview
    ? await countPendingRequests().catch((e) => {
        console.error("[shell] pending count:", e);
        return 0;
      })
    : 0;

  return (
    <Providers flags={flags} mode={mode}>
      <AppShell
        org={org.name}
        userEmail={user.email ?? ""}
        flags={flags}
        mode={mode}
        pendingRequests={pendingRequests}
      >
        {/* Flag checked here as well as inside the slot so the flag-off org
            runs exactly the queries it ran before billing: none. Suspended
            so the billing read never delays the shell. */}
        {flags.billing ? (
          <Suspense fallback={null}>
            <PlanBannerSlot />
          </Suspense>
        ) : null}
        {children}
      </AppShell>
    </Providers>
  );
}
