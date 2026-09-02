"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/features/clients/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBreadcrumbHeader,
  DialogChip,
  DialogContent,
  DialogFooterBar,
  DialogTrigger,
  dialogBareInputClass,
  dialogPanelClass,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function CreateClientDialog() {
  const t = useTranslations("clients.create");
  const tc = useTranslations("common");
  const searchParams = useSearchParams();
  const router = useRouter();
  const urlOpen = searchParams.get("new") === "1";
  const [manuallyOpened, setManuallyOpened] = React.useState(false);
  const open = urlOpen || manuallyOpened;
  const [pending, startTransition] = React.useTransition();

  const onOpenChange = (next: boolean) => {
    setManuallyOpened(next);
    if (!next && urlOpen) router.replace("/clients");
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = new FormData(e.currentTarget).get("name");
    if (typeof name !== "string" || name.trim() === "") return;
    startTransition(async () => {
      const result = await createClient({ name });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onOpenChange(false);
      router.push(`/clients/${result.id}`);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button size="sm">
            <Plus className="size-4" /> {t("title")}
          </Button>
        }
      />
      <DialogContent className={dialogPanelClass}>
        <DialogBreadcrumbHeader chip={<DialogChip>{t("chip")}</DialogChip>}>
          {t("title")}
        </DialogBreadcrumbHeader>
        <form onSubmit={onSubmit} className="flex flex-col">
          <div className="flex flex-col px-5 pt-4 pb-6">
            <input
              aria-label={tc("name")}
              name="name"
              required
              maxLength={120}
              placeholder={t("namePlaceholder")}
              className={cn(dialogBareInputClass, "text-[15px] font-medium")}
              autoFocus
            />
          </div>
          <DialogFooterBar>
            <Button type="submit" size="sm" variant="brand" disabled={pending}>
              {pending ? tc("creating") : t("submit")}
            </Button>
          </DialogFooterBar>
        </form>
      </DialogContent>
    </Dialog>
  );
}
