"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { assignClient, createClient } from "@/features/clients/actions";
import type { ClientOption } from "@/features/clients/queries";

const NEW_SENTINEL = "__new__";

// Compact per-row control. Optimistic value; server truth reconciles via
// revalidatePath. Inline "New…" prompts for a name (window.prompt keeps v1
// minimal — the assign-participant precedent).
export function AssignClient({
  unitId,
  unitName,
  programId,
  clients,
  value,
}: {
  unitId: string;
  unitName: string;
  programId: string;
  clients: ClientOption[];
  value: string | null;
}) {
  const t = useTranslations("clients.assign");
  const te = useTranslations("errors");
  const [optimistic, setOptimistic] = React.useState(value);
  const [isPending, startTransition] = React.useTransition();

  const onChange = (next: string) => {
    if (next === NEW_SENTINEL) {
      const name = window.prompt(t("prompt"))?.trim();
      if (!name) return;
      startTransition(async () => {
        const created = await createClient({ name, programId });
        if (!created.ok) {
          toast.error(created.error);
          return;
        }
        setOptimistic(created.id);
        const assigned = await assignClient({ unitId, clientId: created.id });
        if (!assigned.ok) {
          // The client now exists but isn't assigned — the select would
          // otherwise show a dangling id with no matching option. Revert to
          // the last known-good value and say so explicitly.
          setOptimistic(value);
          toast.error(te("clients.createdNotAssigned"));
        }
      });
      return;
    }
    const clientId = next === "" ? null : next;
    setOptimistic(clientId);
    startTransition(async () => {
      const result = await assignClient({ unitId, clientId });
      if (!result.ok) {
        toast.error(result.error ?? te("generic"));
        // A failed action doesn't revalidate — the control reverts itself.
        setOptimistic(value);
      }
    });
  };

  return (
    <select
      value={optimistic ?? ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={isPending}
      aria-label={t("aria", { unit: unitName })}
      className="border-input text-muted-foreground h-7 max-w-36 shrink-0 truncate rounded-md border bg-transparent px-1.5 text-xs disabled:opacity-50"
    >
      <option value="">{t("none")}</option>
      {clients.map((c) => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
      <option value={NEW_SENTINEL}>{t("new")}</option>
    </select>
  );
}
