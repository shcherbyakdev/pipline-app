import { listClientsDirectory } from "@/features/clients/queries";
import { ClientsDirectory } from "@/features/clients/components/clients-directory";
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
          <ClientsDirectory clients={clients} />
        </>
      )}
    </div>
  );
}
