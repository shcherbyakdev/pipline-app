"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { deleteService } from "@/features/scheduling/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* Delete, from the service page's rail: irreversible (a service with
   bookings is refused server-side, one without simply vanishes), so it takes
   two clicks — the inline Confirm/Keep step the list rows used to carry.
   Not a dialog. */
export function DeleteServiceButton({ id, name, className }: { id: string; name: string; className?: string }) {
  const t = useTranslations("services");
  const tc = useTranslations("common");
  const router = useRouter();
  const [confirming, setConfirming] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const onDelete = () => {
    startTransition(async () => {
      const result = await deleteService({ id });
      if (!result.ok) {
        setConfirming(false);
        toast.error(result.error);
        return;
      }
      toast.success(t("deleted"));
      router.push("/services");
    });
  };

  if (confirming) {
    return (
      <div className="flex items-center gap-1.5 py-[3px]">
        <Button size="xs" variant="destructive" onClick={onDelete} disabled={pending}>
          {pending ? tc("deleting") : t("confirmDelete")}
        </Button>
        <Button size="xs" variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
          {t("keep")}
        </Button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      aria-label={t("deleteNamed", { name })}
      className={cn(className, "text-destructive w-full cursor-pointer bg-transparent text-left")}
    >
      <HugeiconsIcon icon={Delete02Icon} size={14} className="shrink-0" />
      {t("detail.delete")}
    </button>
  );
}
