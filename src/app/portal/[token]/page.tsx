import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { resolvePortalToken, getPortalUnits, clientKeyFrom } from "@/lib/tokens";
import { getOrgBranding } from "@/lib/org-branding";
import { BrandedHeader } from "@/components/branded-header";
import { Badge } from "@/components/ui/badge";

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));

export default async function PortalEntryPage({ params }: PageProps<"/portal/[token]">) {
  const { token } = await params;
  const h = await headers();
  const resolved = await resolvePortalToken(token, clientKeyFrom(h));

  if (resolved.status === "not_found") notFound();
  if (resolved.status === "rate_limited") {
    return (
      <main className="flex flex-col gap-2 pt-16 text-center">
        <h1 className="text-lg font-semibold">Too many requests</h1>
        <p className="text-muted-foreground text-sm">Too many requests — wait a minute and reload.</p>
      </main>
    );
  }
  // `!== "ok"` so TS narrows the remaining union (the /p precedent).
  if (resolved.status !== "ok") {
    return (
      <main className="flex flex-col gap-2 pt-16 text-center">
        <h1 className="text-lg font-semibold">
          This link has {resolved.status === "revoked" ? "been revoked" : "expired"}
        </h1>
        <p className="text-muted-foreground text-sm">Ask {resolved.orgName} to send you a new one.</p>
      </main>
    );
  }

  const { scope } = resolved;
  const [groups, branding] = await Promise.all([
    getPortalUnits(scope),
    getOrgBranding(scope.orgId),
  ]);

  return (
    <main className="flex flex-col gap-6">
      <BrandedHeader
        orgName={scope.orgName}
        accentColor={branding.accentColor}
        logoUrl={branding.logoUrl}
        subtitle={scope.clientName}
      />
      {groups.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing here yet — check back soon.</p>
      ) : (
        groups.map((g) => {
          const done = g.units.filter((u) => u.done === u.total && u.total > 0).length;
          return (
            <section key={g.programId} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">{g.programName}</h2>
                <p className="text-muted-foreground text-xs tabular-nums">
                  {done} of {g.units.length} done
                </p>
              </div>
              <ul className="flex flex-col gap-2">
                {g.units.map((u) => (
                  <li key={u.id}>
                    <Link
                      href={`/portal/${token}/units/${u.id}`}
                      className="flex items-center gap-2 rounded-lg border p-3"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium">{u.name}</span>
                        {u.externalRef ? (
                          <span className="text-muted-foreground font-mono text-xs">{u.externalRef}</span>
                        ) : null}
                      </span>
                      <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
                        {u.lastActivity ? formatDate(u.lastActivity) : "no activity yet"}
                      </span>
                      <Badge
                        variant={u.done === u.total && u.total > 0 ? "secondary" : "outline"}
                        className="shrink-0 text-[10px]"
                      >
                        {u.done === u.total && u.total > 0 ? "complete" : `${u.done}/${u.total} stages`}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </main>
  );
}
