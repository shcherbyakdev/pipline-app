import Link from "next/link";
import { listClientsDirectory } from "@/features/clients/queries";

export default async function ClientsPage() {
  const clients = await listClientsDirectory();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      {clients.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No clients yet — clients appear here after their first booking.
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
      )}
    </div>
  );
}
