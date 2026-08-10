import Link from "next/link";
import { notFound } from "next/navigation";
import { getClient, listClientUnits, listClientLinks } from "@/features/clients/queries";
import { ClientHeader } from "@/features/clients/components/client-header";
import { PortalLinksPanel } from "@/features/clients/components/portal-links-panel";

export default async function ClientDetailPage({ params }: PageProps<"/clients/[id]">) {
  const { id } = await params;
  const [client, units, links] = await Promise.all([
    getClient(id),
    listClientUnits(id),
    listClientLinks(id),
  ]);
  // RLS returns nothing for foreign orgs' clients — the 404 we want.
  if (!client) notFound();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <ClientHeader id={client.id} name={client.name} />
      <div className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-sm font-medium">
          Units ({units.length})
        </h2>
        {units.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No units yet — assign this client on a unit row in a program.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {units.map((u) => (
              <li key={u.unitId}>
                <Link
                  href={`/programs/${u.programId}/units/${u.unitId}`}
                  className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm hover:bg-accent/50"
                >
                  <span className="min-w-0 truncate">{u.unitName}</span>
                  {u.externalRef ? (
                    <span className="text-muted-foreground shrink-0 font-mono text-xs">{u.externalRef}</span>
                  ) : null}
                  <span className="text-muted-foreground ml-auto shrink-0 truncate text-xs">{u.programName}</span>
                  <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
                    {u.done}/{u.total}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <PortalLinksPanel clientId={client.id} links={links} />
    </div>
  );
}
