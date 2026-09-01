"use client";

import * as React from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { previewUnitsImport, importUnits } from "@/features/programs/actions";
import type { ImportRow } from "@/features/programs/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogBreadcrumbHeader,
  DialogChip,
  DialogContent,
  DialogFooterBar,
  DialogTrigger,
  dialogPanelClass,
} from "@/components/ui/dialog";

// The dialog is a small state machine; every stage renders from this one
// discriminated union so a stray click can't cross wires.
type Stage =
  | { step: "pick" }
  | { step: "checking" }
  | { step: "invalid"; errors: string[] }
  | { step: "ready"; rows: ImportRow[]; newCount: number; updateCount: number }
  | { step: "importing" };

export function ImportCsvDialog({ programId }: { programId: string }) {
  const [open, setOpen] = React.useState(false);
  const [stage, setStage] = React.useState<Stage>({ step: "pick" });

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setStage({ step: "pick" });
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setStage({ step: "checking" });
    // Dynamic import keeps Papa Parse out of the main bundle.
    const { parseUnitsCsv } = await import("@/features/programs/csv");
    const parsed = parseUnitsCsv(await file.text());
    if (!parsed.ok) {
      setStage({ step: "invalid", errors: parsed.errors });
      return;
    }
    const preview = await previewUnitsImport({
      programId,
      refs: parsed.rows.map((r) => r.externalRef),
    });
    if (!preview.ok) {
      setStage({ step: "invalid", errors: [preview.error] });
      return;
    }
    setStage({
      step: "ready",
      rows: parsed.rows,
      newCount: parsed.rows.length - preview.existingRefs.length,
      updateCount: preview.existingRefs.length,
    });
  };

  const onConfirm = async (rows: ImportRow[]) => {
    setStage({ step: "importing" });
    const result = await importUnits({ programId, rows });
    if (!result.ok) {
      toast.error(result.error);
      setStage({ step: "pick" });
      return;
    }
    toast.success(
      `Imported ${result.inserted} new, ${result.updated} updated.`,
    );
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            <Upload className="size-4" /> Import CSV
          </Button>
        }
      />
      <DialogContent className={dialogPanelClass}>
        <DialogBreadcrumbHeader chip={<DialogChip>Units</DialogChip>}>
          Import units from CSV
        </DialogBreadcrumbHeader>

        <div className="flex flex-col px-5 pt-4 pb-6">
          {stage.step === "pick" || stage.step === "checking" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="import-csv-file">
                CSV with &quot;name&quot; and &quot;external_ref&quot; columns
              </Label>
              <Input
                id="import-csv-file"
                type="file"
                accept=".csv,text/csv"
                disabled={stage.step === "checking"}
                onChange={(e) => onFile(e.target.files?.[0])}
              />
              {stage.step === "checking" ? (
                <p className="text-muted-foreground text-sm">Checking…</p>
              ) : null}
            </div>
          ) : null}

          {stage.step === "invalid" ? (
            <div className="flex flex-col gap-3">
              <ul className="text-destructive max-h-48 overflow-y-auto text-sm">
                {stage.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
              <p className="text-muted-foreground text-sm">
                Nothing was imported. Fix the file and try again.
              </p>
            </div>
          ) : null}

          {stage.step === "ready" || stage.step === "importing" ? (
            stage.step === "ready" ? (
              <p className="text-sm">
                {stage.rows.length} rows: <strong>{stage.newCount} new</strong>,{" "}
                <strong>{stage.updateCount} updated</strong>. Updates change
                unit names only; progress is untouched.
              </p>
            ) : (
              <p className="text-muted-foreground text-sm">Importing…</p>
            )
          ) : null}
        </div>

        {stage.step === "invalid" ? (
          <DialogFooterBar>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStage({ step: "pick" })}
            >
              Pick another file
            </Button>
          </DialogFooterBar>
        ) : stage.step === "ready" || stage.step === "importing" ? (
          <DialogFooterBar>
            <Button
              variant="outline"
              size="sm"
              disabled={stage.step === "importing"}
              onClick={() => setStage({ step: "pick" })}
            >
              Back
            </Button>
            <Button
              variant="brand"
              size="sm"
              disabled={stage.step === "importing"}
              onClick={() => stage.step === "ready" && onConfirm(stage.rows)}
            >
              {stage.step === "importing" ? "Importing…" : "Import"}
            </Button>
          </DialogFooterBar>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
