// S8 migration kit: pure CSV → import rows for future hourly bookings.
// No DOM, no network — the /utils/import page parses in the browser and the
// server action re-runs the same function on the raw text, so the rows the
// owner previewed are exactly the rows that get written (programs/csv.ts
// idiom). Times are org-local wall clock; the RPC gets UTC instants.
import Papa from "papaparse";
import { wallTimeToUtc } from "@/features/scheduling/slots";

export const MAX_IMPORT_ROWS = 500;
const REQUIRED = ["space", "date", "start", "end", "client_name"] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PAID_YES = new Set(["", "yes", "y", "true", "1", "tak"]);
const PAID_NO = new Set(["no", "n", "false", "0", "nie"]);

export type ImportSpace = {
  id: string;
  name: string;
  slotIncrementMin: number;
  minDurationMin: number;
  maxDurationMin: number;
};
export type ImportContext = { timeZone: string; spaces: ImportSpace[] };

export type ImportRow = {
  /** Spreadsheet row number (header = 1). */
  row: number;
  offeringId: string;
  /** UTC ISO instant. */
  startsAt: string;
  durationMin: number;
  name: string;
  email?: string;
  note?: string;
  paid: boolean;
};
export type InvalidRow = { row: number; reason: string };
export type ParsedBookingsCsv = { ready: ImportRow[]; invalid: InvalidRow[] };

const rowNo = (dataIndex: number) => dataIndex + 2;
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** "2026-02-30" passes the regex but is not a day; round-tripping through UTC catches it. */
function isCalendarDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
}

function fileError(reason: string): ParsedBookingsCsv {
  return { ready: [], invalid: [{ row: 1, reason }] };
}

export function parseBookingsCsv(text: string, ctx: ImportContext): ParsedBookingsCsv {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  const fields = parsed.meta.fields ?? [];
  const missing = REQUIRED.filter((f) => !fields.includes(f));
  if (missing.length > 0) return fileError(`The file needs these columns: ${missing.join(", ")}.`);
  if (parsed.errors.length > 0) {
    return { ready: [], invalid: parsed.errors.map((e) => ({ row: rowNo(e.row ?? 0), reason: e.message })) };
  }
  if (parsed.data.length === 0) return fileError("The file has no data rows.");
  if (parsed.data.length > MAX_IMPORT_ROWS) return fileError(`At most ${MAX_IMPORT_ROWS} rows per file.`);

  const byName = new Map(ctx.spaces.map((s) => [s.name.trim().toLowerCase(), s]));
  const ready: ImportRow[] = [];
  const invalid: InvalidRow[] = [];
  parsed.data.forEach((rec, i) => {
    const row = rowNo(i);
    const get = (k: string) => (rec[k] ?? "").trim();
    const fail = (reason: string) => invalid.push({ row, reason });

    const space = byName.get(get("space").toLowerCase());
    if (!space) return fail(`Unknown space "${get("space")}".`);
    const date = get("date");
    if (!isCalendarDate(date)) return fail(`Bad date "${date}" (YYYY-MM-DD).`);
    const start = get("start");
    const end = get("end");
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) return fail(`Bad start/end time (HH:MM).`);
    const durationMin = minutes(end) - minutes(start);
    if (durationMin <= 0) return fail("End must be after start.");
    if (durationMin < space.minDurationMin || durationMin > space.maxDurationMin || durationMin % space.slotIncrementMin !== 0) {
      return fail(
        `Duration ${durationMin} min does not fit "${space.name}" (${space.minDurationMin}–${space.maxDurationMin} min in steps of ${space.slotIncrementMin}).`,
      );
    }
    const name = get("client_name");
    if (name.length < 1 || name.length > 200) return fail("Client name is required (1–200 characters).");
    const email = get("client_email");
    if (email && (email.length > 320 || !EMAIL_RE.test(email))) return fail(`Bad email "${email}".`);
    const note = get("note");
    if (note.length > 2000) return fail("Note is longer than 2000 characters.");
    const paidRaw = get("paid").toLowerCase();
    if (!PAID_YES.has(paidRaw) && !PAID_NO.has(paidRaw)) return fail(`Bad paid value "${get("paid")}" (yes/no).`);

    ready.push({
      row,
      offeringId: space.id,
      startsAt: wallTimeToUtc(date, start, ctx.timeZone).toISOString(),
      durationMin,
      name,
      email: email || undefined,
      note: note || undefined,
      paid: PAID_YES.has(paidRaw),
    });
  });
  return { ready, invalid };
}
