import { notFound } from "next/navigation";
import { getClient, listClientBookings } from "@/features/clients/queries";
import { ClientHeader } from "@/features/clients/components/client-header";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { whenLineFor, STATUS_LABEL } from "@/features/scheduling/templates";
import { Badge } from "@/components/ui/badge";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ClientDetailPage({ params }: PageProps<"/clients/[id]">) {
  const { id } = await params;
  // Shape-guard before querying: a malformed id would surface as a Postgres
  // cast error (500), not the 404 it actually is.
  if (!UUID_RE.test(id)) notFound();
  const [client, bookings, settings] = await Promise.all([
    getClient(id),
    listClientBookings(id),
    getSchedulingSettings(),
  ]);
  // RLS returns nothing for foreign orgs' clients — the 404 we want.
  if (!client) notFound();
  const timeZone = settings?.timezone ?? "UTC";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <ClientHeader id={client.id} name={client.name} />
        <p className="text-muted-foreground px-3 text-sm">
          {client.email ?? "No email on file"}
        </p>
      </div>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">
          {bookings.length === 100 ? "Bookings (last 100)" : `Bookings (${bookings.length})`}
        </h2>
        {bookings.length === 0 ? (
          <p className="text-muted-foreground text-sm">No bookings yet.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {bookings.map((b) => (
              <li key={b.id} className="flex flex-col gap-1 rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{b.serviceName}</p>
                  <Badge variant="secondary">{STATUS_LABEL[b.status] ?? b.status}</Badge>
                </div>
                <p>
                  {whenLineFor(
                    {
                      startsAt: new Date(b.startsAt),
                      endsAt: new Date(b.endsAt),
                      isRental: b.rentalUnitId !== null,
                      rangeMode: b.rangeMode,
                    },
                    timeZone,
                  )}
                </p>
                {b.note ? <p className="text-muted-foreground">“{b.note}”</p> : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
