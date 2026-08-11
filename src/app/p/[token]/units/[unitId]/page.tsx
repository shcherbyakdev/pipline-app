import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { resolveParticipantToken, getParticipantUnitDetail, clientKeyFrom } from "@/lib/tokens";
import { ParticipantStageSections } from "@/features/participants/components/participant-stage-sections";
import { getOrgBranding } from "@/lib/org-branding";
import { BrandedHeader } from "@/components/branded-header";

export default async function ParticipantUnitPage({
  params,
}: PageProps<"/p/[token]/units/[unitId]">) {
  const { token, unitId } = await params;
  if (!z.uuid().safeParse(unitId).success) notFound();

  const h = await headers();
  const resolved = await resolveParticipantToken(token, clientKeyFrom(h));
  // Expired/revoked mid-flow: bounce to the entry page, which renders the
  // renewal message. Unknown: 404.
  if (resolved.status === "not_found") notFound();
  // Saving a requirement revalidates this page, so a long checklist re-resolves
  // the token many times over. If the limiter trips, say so — never 404.
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
  if (resolved.status !== "ok") {
    return (
      <main className="pt-16 text-center">
        <Link href={`/p/${token}`} className="text-sm underline">This link is no longer active</Link>
      </main>
    );
  }

  const [unit, branding] = await Promise.all([
    getParticipantUnitDetail(resolved.scope, unitId),
    getOrgBranding(resolved.scope.orgId),
  ]);
  if (!unit) notFound(); // out of scope reads as nonexistent

  return (
    <main className="flex flex-col gap-4">
      <BrandedHeader
        orgName={resolved.scope.orgName}
        accentColor={branding.accentColor}
        logoUrl={branding.logoUrl}
      />
      <header className="flex flex-col gap-0.5">
        {resolved.scope.unitId === null ? (
          <Link href={`/p/${token}`} className="text-muted-foreground w-fit text-xs hover:underline">
            ← All units
          </Link>
        ) : null}
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-semibold">{unit.name}</h1>
          {unit.externalRef ? (
            <span className="text-muted-foreground font-mono text-xs">{unit.externalRef}</span>
          ) : null}
        </div>
      </header>
      <ParticipantStageSections token={token} unitId={unit.id} sections={unit.stages} />
    </main>
  );
}
