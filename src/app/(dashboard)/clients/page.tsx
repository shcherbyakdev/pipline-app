import Link from "next/link";
import { listClients } from "@/features/clients/queries";
import { CreateClientDialog } from "@/features/clients/components/create-client-dialog";
import { Badge } from "@/components/ui/badge";

export default async function ClientsPage() {
  const clients = await listClients();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Clients</h1>
        <CreateClientDialog />
      </div>
      {clients.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No clients yet — a client groups units across programs and gets a read-only portal link.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {clients.map((c) => (
            <li key={c.id}>
              <Link
                href={`/clients/${c.id}`}
                className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm hover:bg-accent/50"
              >
                <span className="min-w-0 truncate font-medium">{c.name}</span>
                <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
                  {c.unitCount} {c.unitCount === 1 ? "unit" : "units"}
                </span>
                {c.liveLinkCount > 0 ? (
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    {c.liveLinkCount} live {c.liveLinkCount === 1 ? "link" : "links"}
                  </Badge>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
