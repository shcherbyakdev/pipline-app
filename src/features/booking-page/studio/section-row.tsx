"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslations } from "next-intl";
import { ChevronRight, Eye, EyeOff, GripVertical, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { sectionSummary } from "../doc-ops";
import type { Section } from "../schema";

export function SectionRow({
  section, selected, issueCount, onSelect, onHover, onToggleHidden, onRemove,
}: {
  section: Section; selected: boolean; issueCount: number;
  onSelect: () => void;
  /** Mirrored by the preview's section outline. */
  onHover: (hovering: boolean) => void;
  onToggleHidden: () => void; onRemove: () => void;
}) {
  const t = useTranslations("studio");
  const label = t(`sections.${section.type}.label`);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: section.id });
  const required = section.type === "booking";
  // Quiet until pointed at: hide/remove (and the edit chevron) show on the
  // row's hover or any focus inside it, so the list reads as content first.
  const revealed = "opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100";
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={cn(
        "bg-card group/row flex items-center gap-1.5 rounded-lg border px-1.5 py-1.5",
        selected ? "border-primary ring-1 ring-primary/30" : "hover:border-foreground/20",
        isDragging && "opacity-60 shadow-md",
        section.hidden && "opacity-60",
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={t("row.reorder", { section: label })}
        className="text-muted-foreground hover:text-foreground cursor-grab touch-none rounded p-1 active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </button>
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 flex-col items-start gap-0.5 py-0.5 text-left outline-none">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {label}
          {required ? <Badge variant="outline">{t("row.required")}</Badge> : null}
          {issueCount > 0 ? <Badge variant="destructive">{issueCount}</Badge> : null}
        </span>
        <span className="text-muted-foreground w-full truncate text-xs">{sectionSummary(section, t)}</span>
      </button>
      {required ? null : (
        <>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={section.hidden ? t("row.show") : t("row.hide")}
            aria-pressed={section.hidden}
            onClick={onToggleHidden}
            // A hidden section keeps its toggle visible — that state needs a way back.
            className={section.hidden ? undefined : revealed}
          >
            {section.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </Button>
          <Button size="icon-xs" variant="ghost" aria-label={t("row.remove")} onClick={onRemove} className={revealed}>
            <Trash2 className="size-3.5" />
          </Button>
        </>
      )}
      <ChevronRight aria-hidden className={cn("text-muted-foreground size-3.5 shrink-0", revealed)} />
    </li>
  );
}
