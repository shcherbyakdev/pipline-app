"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { previewBookingsImport, runBookingsImport } from "@/features/utils/import-actions";
import type { ImportRow, InvalidRow } from "@/features/utils/import-rows";
import type { ImportResult } from "@/features/utils/import-run";

/* Three states, one file: pick → preview ("N ready, M invalid", row numbers)
   → results per row. The raw text travels to both actions so what was
   previewed is what gets written. Internal tool: English only, no i18n. */
type Preview = { ready: ImportRow[]; invalid: InvalidRow[] };

const TEMPLATE = "space,date,start,end,client_name,client_email,note,paid";

export function ImportPanel({ orgId }: { orgId: string }) {
  const [text, setText] = React.useState<string | null>(null);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [results, setResults] = React.useState<ImportResult[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setPreview(null);
    setResults(null);
    setError(null);
    if (!file) return;
    setFileName(file.name);
    file.text().then((t) => {
      setText(t);
      startTransition(async () => {
        const out = await previewBookingsImport({ orgId, text: t });
        if (out.ok) setPreview({ ready: out.ready, invalid: out.invalid });
        else setError(out.error);
      });
    });
  }

  function confirm() {
    if (!text) return;
    startTransition(async () => {
      const out = await runBookingsImport({ orgId, text });
      if (out.ok) setResults(out.results);
      else setError(out.error);
    });
  }

  const counts = results
    ? {
        created: results.filter((r) => r.status === "created").length,
        skipped: results.filter((r) => r.status === "skipped").length,
        failed: results.filter((r) => r.status === "failed").length,
      }
    : null;

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-muted-foreground">
        Columns: <code className="font-mono text-xs">{TEMPLATE}</code>. Times are the studio&apos;s local time; <code className="font-mono text-xs">paid</code> defaults
        to yes and settles the booking as a manual payment. Set the studio&apos;s opening hours and prices first — rows the setup refuses come back as
        failed, and a re-run skips rows already imported. See <code className="font-mono text-xs">docs/migration/</code>.
      </p>
      <label className="flex flex-col gap-1">
        <span className="font-medium">CSV file</span>
        <input type="file" accept=".csv,text/csv" onChange={onFile} disabled={pending} className="max-w-md" />
      </label>
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      {preview && !results ? (
        <section className="flex flex-col gap-3" aria-live="polite">
          <p>
            <span className="font-medium">{fileName}</span>: {preview.ready.length} ready, {preview.invalid.length} invalid.
          </p>
          {preview.invalid.length > 0 ? (
            <ul className="text-destructive list-disc pl-5">
              {preview.invalid.map((i) => (
                <li key={i.row}>
                  Row {i.row}: {i.reason}
                </li>
              ))}
            </ul>
          ) : null}
          {preview.ready.length > 0 ? (
            <Button type="button" size="sm" variant="brand" onClick={confirm} disabled={pending}>
              {pending ? "Importing…" : `Import ${preview.ready.length} ${preview.ready.length === 1 ? "booking" : "bookings"}`}
            </Button>
          ) : null}
        </section>
      ) : null}
      {results && counts ? (
        <section className="flex flex-col gap-3" aria-live="polite">
          <p role="status">
            <span className="font-medium">Done:</span> {counts.created} created, {counts.skipped} skipped, {counts.failed} failed.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-muted-foreground text-xs uppercase tracking-wide">
                <tr>
                  <th className="py-1 pr-3">Row</th>
                  <th className="py-1 pr-3">Result</th>
                  <th className="py-1">Note</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.row} className="border-t">
                    <td className="py-1 pr-3 tabular-nums">{r.row}</td>
                    <td className={`py-1 pr-3 ${r.status === "failed" ? "text-destructive" : r.status === "skipped" ? "text-muted-foreground" : ""}`}>
                      {r.status}
                    </td>
                    <td className="py-1">{r.reason ?? (r.bookingId ? <span className="text-muted-foreground font-mono text-xs">{r.bookingId}</span> : null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
