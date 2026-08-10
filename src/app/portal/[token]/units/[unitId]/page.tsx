import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { resolvePortalToken, getPortalUnitDetail, clientKeyFrom } from "@/lib/tokens";
import type { PortalItem } from "@/lib/tokens";
import { getOrgBranding } from "@/lib/org-branding";
import { BrandedHeader } from "@/components/branded-header";
import { Badge } from "@/components/ui/badge";

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));

// Typed values → display strings. Dates pass through formatDate; booleans
// read as Yes/No; photo items render tiles instead of a value line.
function formatValue(item: PortalItem): string {
  if (item.value === null) return "—";
  if (item.type === "boolean") return item.value ? "Yes" : "No";
  if (item.type === "date") return formatDate(String(item.value));
  return String(item.value);
}

export default async function PortalUnitPage({ params }: PageProps<"/portal/[token]/units/[unitId]">) {
  const { token, unitId } = await params;
  if (!z.uuid().safeParse(unitId).success) notFound();

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
  if (resolved.status !== "ok") {
    return (
      <main className="pt-16 text-center">
        <Link href={`/portal/${token}`} className="text-sm underline">This link is no longer active</Link>
      </main>
    );
  }

  const [unit, branding] = await Promise.all([
    getPortalUnitDetail(resolved.scope, unitId),
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
        <Link href={`/portal/${token}`} className="text-muted-foreground w-fit text-xs hover:underline">
          ← All sites
        </Link>
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-semibold">{unit.name}</h1>
          {unit.externalRef ? (
            <span className="text-muted-foreground font-mono text-xs">{unit.externalRef}</span>
          ) : null}
        </div>
        <p className="text-muted-foreground text-xs">{unit.programName}</p>
      </header>
      <ol className="flex flex-col gap-3">
        {unit.stages.map((s) => (
          <li key={s.id} className="rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{s.name}</span>
              {s.status === "done" ? (
                <Badge variant="secondary" className="ml-auto shrink-0 text-[10px]">
                  done{s.doneAt ? ` · ${formatDate(s.doneAt)}` : ""}
                </Badge>
              ) : (
                <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">
                  awaiting
                </Badge>
              )}
            </div>
            {/* THE portal rule: pending stages render nothing below the name. */}
            {s.items.length > 0 ? (
              <dl className="mt-2 flex flex-col gap-1.5">
                {s.items.map((item) => (
                  <div key={item.id} className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <dt className="text-muted-foreground min-w-0 truncate">{item.label}</dt>
                      {item.type !== "photo" ? (
                        <dd className="shrink-0 font-medium">{formatValue(item)}</dd>
                      ) : null}
                    </div>
                    {item.photos.length > 0 ? (
                      <dd className="flex flex-wrap gap-2">
                        {item.photos.map((p) =>
                          p.url ? (
                            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed Supabase URL
                            <img
                              key={p.id}
                              src={p.url}
                              alt={p.filename}
                              className="h-20 w-20 rounded-md border object-cover"
                            />
                          ) : (
                            <span
                              key={p.id}
                              className="text-muted-foreground flex h-20 w-20 items-center justify-center rounded-md border p-1 text-center text-[10px]"
                            >
                              {p.filename}
                            </span>
                          ),
                        )}
                      </dd>
                    ) : null}
                  </div>
                ))}
              </dl>
            ) : null}
          </li>
        ))}
      </ol>
    </main>
  );
}
