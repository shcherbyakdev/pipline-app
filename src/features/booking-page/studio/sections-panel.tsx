"use client";

import * as React from "react";
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { OrgMode } from "@/features/orgs/mode";
import type { PlanLimits } from "@/lib/billing/plans";
import { DEFAULT_PAGE, SECTION_META } from "../defaults";
import {
  deepEqual, emptyVisibleSections, insertSection, moveSection, removeSection, setSectionHidden, type EmptyContext,
} from "../doc-ops";
import type { SectionType } from "../schema";
import { AddSectionPopover } from "./add-section-popover";
import { ConfirmDialog } from "./confirm-dialog";
import { LayoutToggle } from "./layout-toggle";
import { PublishBar } from "./publish-bar";
import { SectionRow } from "./section-row";
import type { PageDraft } from "./use-page-draft";

export function SectionsPanel({
  draft, selectedId, onSelect, emptyContext, liveUrl, pageSections, mode, templatePicker,
}: {
  draft: PageDraft; selectedId: string | null; onSelect: (id: string | null) => void;
  emptyContext: EmptyContext; liveUrl: string | null; pageSections: PlanLimits["pageSections"]; mode: OrgMode;
  /** The picker-mode StarterDialog (spec 2026-08-28 §5.4). */
  templatePicker: React.ReactNode;
}) {
  const { doc, update, status, issues, busy, retry, publish, discard, unpublished, published } = draft;
  const [confirm, setConfirm] = React.useState<"discard" | "publish" | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
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
  const empties = emptyVisibleSections(doc, emptyContext);
  const onPublishClick = () => (empties.length > 0 ? setConfirm("publish") : publish());

  return (
    <div className="flex flex-col gap-4">
      <PublishBar
        status={status}
        unpublished={unpublished}
        neverPublished={published === null}
        busy={busy}
        pageIssue={issues[""] ? Object.values(issues[""])[0] : undefined}
        liveUrl={liveUrl}
        onRetry={retry}
        onPublish={onPublishClick}
        onDiscard={() => setConfirm("discard")}
      />
      <div className="flex items-center justify-between gap-3">
        <LayoutToggle value={doc.layout} onChange={(layout) => update((d) => ({ ...d, layout }))} />
        {templatePicker}
      </div>
      {published === null && deepEqual(doc, DEFAULT_PAGE) ? (
        <p className="text-muted-foreground text-xs">This is the default page. Pick a template or add sections.</p>
      ) : null}
      <DndContext id={dndId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={doc.sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-1.5">
            {doc.sections.map((s) => (
              <SectionRow
                key={s.id}
                section={s}
                selected={s.id === selectedId}
                issueCount={Object.keys(issues[s.id] ?? {}).length}
                onSelect={() => onSelect(s.id)}
                onToggleHidden={() => update((d) => setSectionHidden(d, s.id, !s.hidden))}
                onRemove={() => {
                  update((d) => removeSection(d, s.id));
                  if (selectedId === s.id) onSelect(null);
                }}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <AddSectionPopover doc={doc} pageSections={pageSections} mode={mode} onAdd={add} />
      <ConfirmDialog
        open={confirm === "discard"}
        title="Discard changes?"
        description={published ? "Your draft goes back to the published page." : "Your draft goes back to the default page."}
        confirmLabel="Discard"
        destructive
        onConfirm={() => { setConfirm(null); discard(); }}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "publish"}
        title={`${empties.length} ${empties.length === 1 ? "section is" : "sections are"} empty`}
        description={`${empties.map((s) => SECTION_META[s.type].label).join(", ")} won't show on the published page. Publish anyway?`}
        confirmLabel="Publish"
        onConfirm={() => { setConfirm(null); publish(); }}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}
