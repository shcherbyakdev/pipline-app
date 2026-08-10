import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { resolveParticipantToken, getParticipantUnitDetail } from "@/lib/tokens";
import { ParticipantStageSections } from "@/features/participants/components/participant-stage-sections";

export default async function ParticipantUnitPage({
  params,
}: PageProps<"/p/[token]/units/[unitId]">) {
  const { token, unitId } = await params;
  if (!z.uuid().safeParse(unitId).success) notFound();

  const h = await headers();
  const clientKey = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "server";
  const resolved = await resolveParticipantToken(token, clientKey);
  // Expired/revoked mid-flow: bounce to the entry page, which renders the
  // renewal message. Unknown: 404.
  if (resolved.status === "not_found") notFound();
  if (resolved.status !== "ok") {
    return (
      <main className="pt-16 text-center">
        <Link href={`/p/${token}`} className="text-sm underline">This link is no longer active</Link>
      </main>
    );
  }

  const unit = await getParticipantUnitDetail(resolved.scope, unitId);
  if (!unit) notFound(); // out of scope reads as nonexistent

  return (
    <main className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        {resolved.scope.unitId === null ? (
          <Link href={`/p/${token}`} className="text-muted-foreground w-fit text-xs hover:underline">
            ← All units
          </Link>
        ) : (
          <p className="text-muted-foreground text-xs">
            {resolved.scope.orgName} · {resolved.scope.programName}
          </p>
        )}
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
