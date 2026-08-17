"use client";

import * as React from "react";
import { toast } from "sonner";
import { deleteService } from "@/features/scheduling/actions";
import type { ServiceRow } from "@/features/scheduling/queries";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ServiceDialog } from "./service-dialog";

// Solo rule: one active person means the count is always "1 of 1" — noise, so
// the hint only exists once there is a team to narrow.
function teamLabel(service: ServiceRow, activeStaff: StaffRow[]): string | null {
  if (activeStaff.length < 2) return null;
  const assigned = activeStaff.filter((s) => service.staffIds.includes(s.id)).length;
  if (assigned === 0) return "No team members";
  return `${assigned} of ${activeStaff.length} team members`;
}

function Row({ service, staff }: { service: ServiceRow; staff: StaffRow[] }) {
  const [pending, startTransition] = React.useTransition();
  const team = teamLabel(
    service,
    staff.filter((s) => s.active),
  );

  const onDelete = () => {
    startTransition(async () => {
      const result = await deleteService({ id: service.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Deleted");
    });
  };

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{service.name}</span>
          {!service.active ? <Badge variant="outline">Inactive</Badge> : null}
        </div>
        <p className="text-muted-foreground text-xs">
          {service.durationMin} min{service.priceLabel ? ` · ${service.priceLabel}` : ""}
          {team ? ` · ${team}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ServiceDialog service={service} staff={staff} />
        <Button size="sm" variant="outline" onClick={onDelete} disabled={pending}>
          {pending ? "Deleting…" : "Delete"}
        </Button>
      </div>
    </li>
  );
}

export function ServicesList({
  services,
  staff,
}: {
  services: ServiceRow[];
  staff: StaffRow[];
}) {
  return (
    <ol className="flex flex-col gap-2">
      {services.map((service) => (
        <Row key={service.id} service={service} staff={staff} />
      ))}
    </ol>
  );
}
