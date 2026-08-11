// Pure CSV → ImportRow[] validation for the import dialog (slice 5b).
// No DOM, no network — unit-testable in Node. The dialog imports this
// module dynamically so Papa Parse stays out of the main bundle.
import Papa from "papaparse";
import { unitName, importExternalRef, MAX_IMPORT_ROWS, type ImportRow } from "./schema";

export type ParseCsvResult = { ok: true; rows: ImportRow[] } | { ok: false; errors: string[] };

// Spreadsheet row numbers: header = row 1, first data row = row 2.
const rowNo = (dataIndex: number) => dataIndex + 2;

export function parseUnitsCsv(text: string): ParseCsvResult {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  const fields = parsed.meta.fields ?? [];
  if (!fields.includes("name") || !fields.includes("external_ref")) {
    return { ok: false, errors: ['The file needs "name" and "external_ref" columns.'] };
  }
  if (parsed.errors.length > 0) {
    return {
      ok: false,
      errors: parsed.errors.map((e) => `Row ${rowNo(e.row ?? 0)}: ${e.message}`),
    };
  }
  if (parsed.data.length === 0) {
    return { ok: false, errors: ["The file has no data rows."] };
  }
  if (parsed.data.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      errors: [`Too many rows (${parsed.data.length}); the limit is ${MAX_IMPORT_ROWS}.`],
    };
  }

  const errors: string[] = [];
  const rows: ImportRow[] = [];
  const firstSeenRow = new Map<string, number>();

  parsed.data.forEach((raw, i) => {
    const name = unitName.safeParse(raw.name ?? "");
    const ref = importExternalRef.safeParse(raw.external_ref ?? "");
    if (!name.success) errors.push(`Row ${rowNo(i)}: name must be 1–120 characters.`);
    if (!ref.success) errors.push(`Row ${rowNo(i)}: external_ref must be 1–120 characters.`);
    if (!name.success || !ref.success) return;

    const seenAt = firstSeenRow.get(ref.data);
    if (seenAt !== undefined) {
      errors.push(
        `Row ${rowNo(i)}: duplicate external_ref "${ref.data}" (first used on row ${seenAt}).`,
      );
      return;
    }
    firstSeenRow.set(ref.data, rowNo(i));
    rows.push({ name: name.data, externalRef: ref.data });
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, rows };
}
