"use client";

import * as React from "react";
import { toast } from "sonner";
import { deleteService } from "@/features/scheduling/actions";
import type { ServiceRow } from "@/features/scheduling/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ServiceDialog } from "./service-dialog";

function Row({ service }: { service: ServiceRow }) {
  const [pending, startTransition] = React.useTransition();

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
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ServiceDialog service={service} />
        <Button size="sm" variant="outline" onClick={onDelete} disabled={pending}>
          {pending ? "Deleting…" : "Delete"}
        </Button>
      </div>
    </li>
  );
}

export function ServicesList({ services }: { services: ServiceRow[] }) {
  return (
    <ol className="flex flex-col gap-2">
      {services.map((service) => (
        <Row key={service.id} service={service} />
      ))}
    </ol>
  );
}
