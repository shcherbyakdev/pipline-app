import { listServices } from "@/features/scheduling/queries";
import { listStaff } from "@/features/scheduling/staff-queries";
import { ServicesList } from "@/features/scheduling/components/services-list";
import { ServiceDialog } from "@/features/scheduling/components/service-dialog";

export default async function ServicesPage() {
  // Team (multi-staff): the roster comes along so each service can say who
  // offers it. The whole roster, not just the active part — an edit must not
  // silently drop a deactivated person's assignment.
  const [services, staff] = await Promise.all([listServices(), listStaff()]);
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center justify-end">
        <ServiceDialog staff={staff} />
      </div>
      {services.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No services yet — a service is what clients pick on your booking page (name, duration,
          buffers, limits).
        </p>
      ) : (
        <ServicesList services={services} staff={staff} />
      )}
    </div>
  );
}
