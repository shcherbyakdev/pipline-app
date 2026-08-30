import Link from "next/link";
import { listClientsDirectory } from "@/features/clients/queries";
import { EmptyState } from "@/components/shared/empty-state";
import { PageIntro } from "@/components/shell/page-header";

export default async function ClientsPage() {
  const clients = await listClientsDirectory();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      {clients.length === 0 ? (
        <EmptyState title="No clients yet">
          Clients appear here automatically after their first booking — with their bookings,
          notes and links in one place.
        </EmptyState>
      ) : (
        <>
        <PageIntro>Everyone who has booked with you, and their history.</PageIntro>
        <ul className="flex flex-col gap-2">
          {clients.map((c) => (
            <li key={c.id}>
              <Link
                href={`/clients/${c.id}`}
                className="bg-card hover:bg-accent/40 flex items-center gap-3 rounded-xl border px-4 py-3 text-sm transition-colors duration-150 ease-strong"
              >
                <span className="min-w-0 truncate font-medium">{c.name}</span>
                {c.email ? (
                  <span className="text-muted-foreground min-w-0 truncate text-xs">
                    {c.email}
                  </span>
                ) : null}
                <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
                  {c.bookingCount} {c.bookingCount === 1 ? "booking" : "bookings"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        </>
      )}
    </div>
  );
}
