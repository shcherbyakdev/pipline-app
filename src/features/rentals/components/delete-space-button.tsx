"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { deleteOffering } from "@/features/rentals/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* Delete, from the space page's rail: irreversible, so it takes two clicks
   — the inline Confirm/Keep step the list rows used to carry. Not a dialog. */
export function DeleteSpaceButton({ id, name, className }: { id: string; name: string; className?: string }) {
  const t = useTranslations("spaces");
  const tc = useTranslations("common");
  const router = useRouter();
  const [confirming, setConfirming] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const onDelete = () => {
    startTransition(async () => {
      const result = await deleteOffering({ id });
      if (!result.ok) {
        setConfirming(false);
        toast.error(result.error);
        return;
      }
      toast.success(t("list.deleted"));
      router.push("/rentals");
    });
  };

  if (confirming) {
    return (
      <div className="flex items-center gap-1.5 py-[3px]">
        <Button size="xs" variant="destructive" onClick={onDelete} disabled={pending}>
          {pending ? tc("deleting") : t("list.confirmDelete")}
        </Button>
        <Button size="xs" variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
          {t("list.keep")}
        </Button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      aria-label={t("list.deleteAria", { name })}
      className={cn(className, "text-destructive w-full cursor-pointer bg-transparent text-left")}
    >
      <HugeiconsIcon icon={Delete02Icon} size={14} className="shrink-0" />
      {t("detail.delete")}
    </button>
  );
}
