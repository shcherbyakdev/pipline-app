import { listServices } from "@/features/scheduling/queries";
import { ServicesList } from "@/features/scheduling/components/services-list";
import { ServiceDialog } from "@/features/scheduling/components/service-dialog";

export default async function ServicesPage() {
  const services = await listServices();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center justify-end">
        <ServiceDialog />
      </div>
      {services.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No services yet — a service is what clients pick on your booking page (name, duration,
          buffers, limits).
        </p>
      ) : (
        <ServicesList services={services} />
      )}
    </div>
  );
}
