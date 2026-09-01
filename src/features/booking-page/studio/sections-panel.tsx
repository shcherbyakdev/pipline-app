"use client";

import * as React from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { OrgMode } from "@/features/orgs/mode";
import type { PlanLimits } from "@/lib/billing/plans";
import { DEFAULT_PAGE } from "../defaults";
import {
  deepEqual,
  insertSection,
  moveSection,
  removeSection,
  setSectionHidden,
} from "../doc-ops";
import type { SectionType } from "../schema";
import { AddSectionPopover } from "./add-section-popover";
import { LayoutToggle } from "./layout-toggle";
import { SectionRow } from "./section-row";
import type { PageDraft } from "./use-page-draft";

export function SectionsPanel({
  draft,
  selectedId,
  onSelect,
  onHover,
  pageSections,
  mode,
  templatePicker,
}: {
  draft: PageDraft;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Echoed by the preview's section outline. */
  onHover: (id: string | null) => void;
  pageSections: PlanLimits["pageSections"];
  mode: OrgMode;
  /** The picker-mode StarterDialog (spec 2026-08-28 §5.4). */
  templatePicker: React.ReactNode;
}) {
  const { doc, update, issues, published } = draft;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  // dnd-kit derives its aria ids from a module counter unless given one — a
  // server/client mismatch on every load. React's useId is SSR-stable.
  const dndId = React.useId();

  const onDragEnd = (e: DragEndEvent) => {
    const over = e.over;
    if (!over || over.id === e.active.id) return;
    update((d) => moveSection(d, String(e.active.id), String(over.id)));
  };
  const add = (type: SectionType) => {
    let newId = "";
    update((d) => {
      const inserted = insertSection(d, type, selectedId);
      newId = inserted.id;
      return inserted.doc;
    });
    onSelect(newId);
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <LayoutToggle
          value={doc.layout}
          onChange={(layout) => update((d) => ({ ...d, layout }))}
        />
        {templatePicker}
      </div>
      {published === null && deepEqual(doc, DEFAULT_PAGE) ? (
        <p className="text-muted-foreground text-xs">
          This is the default page. Pick a template or add sections.
        </p>
      ) : null}
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={doc.sections.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="flex flex-col gap-1.5">
            {doc.sections.map((s) => (
              <SectionRow
                key={s.id}
                section={s}
                selected={s.id === selectedId}
                issueCount={Object.keys(issues[s.id] ?? {}).length}
                onSelect={() => onSelect(s.id)}
                onHover={(hovering) => onHover(hovering ? s.id : null)}
                onToggleHidden={() =>
                  update((d) => setSectionHidden(d, s.id, !s.hidden))
                }
                onRemove={() => {
                  update((d) => removeSection(d, s.id));
                  if (selectedId === s.id) onSelect(null);
                }}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <AddSectionPopover
        doc={doc}
        pageSections={pageSections}
        mode={mode}
        onAdd={add}
      />
    </div>
  );
}
