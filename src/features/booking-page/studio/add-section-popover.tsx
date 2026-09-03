"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { OrgMode } from "@/features/orgs/mode";
import type { PlanLimits } from "@/lib/billing/plans";
import { canAddSection } from "../doc-ops";
import { addableTypes, sectionAllowed } from "../gating";
import type { PageDocument, SectionType } from "../schema";

export function AddSectionPopover({
  doc, pageSections, mode, onAdd,
}: {
  doc: PageDocument; pageSections: PlanLimits["pageSections"]; mode: OrgMode; onAdd: (type: SectionType) => void;
}) {
  const t = useTranslations("studio");
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="w-full">
            <Plus className="size-3.5" /> {t("addSection")}
          </Button>
        }
      />
      <PopoverContent align="start" className="w-80 p-2">
        <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
          {addableTypes(mode).map((type) => {
            const can = canAddSection(doc, type, t);
            const allowed = sectionAllowed(type, { pageSections });
            const disabled = !can.ok || !allowed;
            return (
              <li key={type}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    onAdd(type);
                    setOpen(false);
                  }}
                  className="hover:bg-muted flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {t(`sections.${type}.label`)}
                    {!allowed ? <Badge variant="secondary">{t("proBadge")}</Badge> : null}
                  </span>
                  <span className="text-muted-foreground text-xs">{can.ok ? t(`sections.${type}.description`) : can.reason}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
