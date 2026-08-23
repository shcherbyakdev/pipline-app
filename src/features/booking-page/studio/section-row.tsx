"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Eye, EyeOff, GripVertical, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SECTION_META } from "../defaults";
import { sectionSummary } from "../doc-ops";
import type { Section } from "../schema";

export function SectionRow({
  section, selected, issueCount, onSelect, onToggleHidden, onRemove,
}: {
  section: Section; selected: boolean; issueCount: number;
  onSelect: () => void; onToggleHidden: () => void; onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: section.id });
  const required = section.type === "booking";
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "bg-card flex items-center gap-1.5 rounded-lg border px-1.5 py-1.5",
        selected && "border-primary ring-1 ring-primary/30",
        isDragging && "opacity-60 shadow-md",
        section.hidden && "opacity-60",
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${SECTION_META[section.type].label}`}
        className="text-muted-foreground hover:text-foreground cursor-grab touch-none rounded p-1 active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </button>
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 flex-col items-start gap-0.5 py-0.5 text-left">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {SECTION_META[section.type].label}
          {required ? <Badge variant="outline">Required</Badge> : null}
          {issueCount > 0 ? <Badge variant="destructive">{issueCount}</Badge> : null}
        </span>
        <span className="text-muted-foreground w-full truncate text-xs">{sectionSummary(section)}</span>
      </button>
      {required ? null : (
        <>
          <Button size="icon-xs" variant="ghost" aria-label={section.hidden ? "Show section" : "Hide section"} aria-pressed={section.hidden} onClick={onToggleHidden}>
            {section.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </Button>
          <Button size="icon-xs" variant="ghost" aria-label="Remove section" onClick={onRemove}>
            <Trash2 className="size-3.5" />
          </Button>
        </>
      )}
    </li>
  );
}
