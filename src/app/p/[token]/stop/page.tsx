import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { resolveParticipantToken, getParticipantUnits, clientKeyFrom } from "@/lib/tokens";
import { getOrgBranding } from "@/lib/org-branding";
import { BrandedHeader } from "@/components/branded-header";
import { Button } from "@/components/ui/button";
import { stopChase } from "@/features/chasing/stop-actions";

export default async function ParticipantStopPage({
  params,
  searchParams,
}: PageProps<"/p/[token]/stop">) {
  const { token } = await params;
  const { stopped } = await searchParams;
  const h = await headers();
  const resolved = await resolveParticipantToken(token, clientKeyFrom(h));

  if (resolved.status === "not_found") notFound();
  // Throttled, not dead — never a 404, which would read as "your link was
  // taken away" for what is a wait-a-moment condition.
  if (resolved.status === "rate_limited") {
    return (
      <main className="flex flex-col gap-2 pt-16 text-center">
        <h1 className="text-lg font-semibold">Too many requests</h1>
        <p className="text-muted-foreground text-sm">
          Too many requests — wait a minute and reload.
        </p>
      </main>
    );
  }
  // A stale/expired/revoked link cannot opt out in v1 — same branch as the
  // entry page, no separate "can't stop this" copy.
  if (resolved.status !== "ok") {
    return (
      <main className="flex flex-col gap-2 pt-16 text-center">
        <h1 className="text-lg font-semibold">This link has {resolved.status === "revoked" ? "been revoked" : "expired"}</h1>
        <p className="text-muted-foreground text-sm">
          Ask {resolved.orgName} to send you a new one.
        </p>
      </main>
    );
  }

  const { scope } = resolved;
  const [units, branding] = await Promise.all([
    scope.unitId ? getParticipantUnits(scope) : Promise.resolve([]),
    getOrgBranding(scope.orgId),
  ]);
  const unitName = units[0]?.name ?? null;

  // Inline server action: a POST-only mutation on a page an email client may
  // prefetch via GET. Redirects to this same page with ?stopped=1 rather
  // than returning action state, so a reload after confirming re-renders
  // the same confirmation without resubmitting. Branch on the RPC result
  // BEFORE calling redirect — redirect() throws internally to unwind
  // control flow, so it must be the last thing this function does, called
  // exactly once, never inside a try/catch that could swallow that throw.
  async function stop() {
    "use server";
    const result = await stopChase({ token });
    redirect(`/p/${token}/stop?stopped=${result.ok ? "1" : "error"}`);
  }

  return (
    <main className="flex flex-col gap-4">
      <BrandedHeader
        orgName={scope.orgName}
        accentColor={branding.accentColor}
        logoUrl={branding.logoUrl}
        subtitle={scope.programName}
      />
      {stopped === "1" ? (
        <div className="flex flex-col gap-2 pt-8 text-center">
          <h1 className="text-lg font-semibold">Done</h1>
          <p className="text-muted-foreground text-sm">
            No more reminders for this. Your link still works if you want to finish the job.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4 pt-8 text-center">
          {stopped === "error" ? (
            <>
              <h1 className="text-lg font-semibold">Something went wrong</h1>
              <p className="text-muted-foreground text-sm">
                We couldn&apos;t stop the reminders — please try again.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-lg font-semibold">
                Stop reminders for {scope.programName}
                {unitName ? ` — ${unitName}` : ""}?
              </h1>
              <p className="text-muted-foreground text-sm">
                You&apos;ll stop getting reminder emails for this. Your link keeps working if you
                change your mind.
              </p>
            </>
          )}
          <form action={stop}>
            <Button type="submit" variant="outline" className="w-full">
              Stop reminders
            </Button>
          </form>
        </div>
      )}
    </main>
  );
}
