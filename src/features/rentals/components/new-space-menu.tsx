"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronDown, Plus } from "lucide-react";
import type { VariantProps } from "class-variance-authority";
import { Button, type buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { OFFERING_KINDS } from "@/features/rentals/pricing-rules";

/* The list's New button, once the org has an hourly room: a room is still
   the first item, and the two studio-ops kinds (S6) sit under it instead
   of leading the create page. An org with no hourly room gets the plain
   link (rentals/page.tsx) — a whole studio or an add-on needs a room. */
export function NewSpaceMenu(variant: VariantProps<typeof buttonVariants>) {
  const t = useTranslations("spaces");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button {...variant} className="w-fit">
            <Plus className="size-4" /> {t("newButton")}
            <ChevronDown className="text-muted-foreground" data-icon="inline-end" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        {OFFERING_KINDS.map((kind) => (
          <DropdownMenuItem key={kind} render={<Link href={kind === "space" ? "/rentals/new" : `/rentals/new?kind=${kind}`} />}>
            <span className="flex flex-col">
              <span>{t(`form.kind.${kind}`)}</span>
              <span className="text-muted-foreground text-xs">{t(`form.kind.${kind}Hint`)}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
