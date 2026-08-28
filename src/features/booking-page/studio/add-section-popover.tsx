"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { OrgMode } from "@/features/orgs/mode";
import type { PlanLimits } from "@/lib/billing/plans";
import { addableEntries, sectionAllowed } from "../gating";
import type { BookingChannel, PageDocument, SectionType } from "../schema";

export function AddSectionPopover({
  doc, pageSections, mode, onAdd,
}: {
  doc: PageDocument; pageSections: PlanLimits["pageSections"]; mode: OrgMode;
  /** `channel` only with `booking`: a per-channel widget (addableEntries). */
  onAdd: (type: SectionType, channel?: BookingChannel) => void;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="w-full">
            <Plus className="size-3.5" /> Add section
          </Button>
        }
      />
      <PopoverContent align="start" className="w-80 p-2">
        <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
          {addableEntries(doc, mode).map((entry) => {
            const { type, channel, can } = entry;
            const allowed = sectionAllowed(type, { pageSections });
            const disabled = !can.ok || !allowed;
            return (
              <li key={channel ? `${type}:${channel}` : type}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    onAdd(type, channel);
                    setOpen(false);
                  }}
                  className="hover:bg-muted flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {entry.label}
                    {!allowed ? <Badge variant="secondary">Pro</Badge> : null}
                  </span>
                  <span className="text-muted-foreground text-xs">{can.ok ? entry.description : can.reason}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
