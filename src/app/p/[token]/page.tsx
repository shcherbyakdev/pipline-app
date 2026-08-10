import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { resolveParticipantToken, getParticipantUnits, clientKeyFrom } from "@/lib/tokens";
import { Badge } from "@/components/ui/badge";

export default async function ParticipantEntryPage({ params }: PageProps<"/p/[token]">) {
  const { token } = await params;
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
  // `!== "ok"` (rather than `=== "expired" || === "revoked"`) so TS narrows
  // the remaining union to the "ok" arm below — the discriminant on this
  // arm is a literal union ("expired" | "revoked"), which equality
  // narrowing on individual literals doesn't eliminate as a whole member.
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
  if (scope.unitId) redirect(`/p/${token}/units/${scope.unitId}`);

  const units = await getParticipantUnits(scope);
  return (
    <main className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <p className="text-muted-foreground text-xs">{scope.orgName} · {scope.programName}</p>
        <h1 className="text-lg font-semibold">Hi {scope.participantName}</h1>
      </header>
      {units.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing assigned to you right now.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {units.map((u) => (
            <li key={u.id}>
              <Link
                href={`/p/${token}/units/${u.id}`}
                className="flex items-center gap-2 rounded-lg border p-3"
              >
                <span className="flex flex-col">
                  <span className="text-sm font-medium">{u.name}</span>
                  {u.externalRef ? (
                    <span className="text-muted-foreground font-mono text-xs">{u.externalRef}</span>
                  ) : null}
                </span>
                <Badge variant={u.outstanding === 0 ? "secondary" : "outline"} className="ml-auto text-[10px]">
                  {u.outstanding === 0 ? "all done" : `${u.outstanding} of ${u.total} stages open`}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
