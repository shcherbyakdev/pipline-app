"use server";
// S8 migration kit: the two server actions behind /utils/import. Both gate on
// the internal allowlist (guard.ts) and act through the admin client — the
// migrating studio's owner is not in the room, Booklo staff are. Parsing
// happens server-side on the raw CSV text for both steps, so the rows the
// owner previewed are exactly the rows that get written.
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireInternal } from "./guard";
import { parseBookingsCsv, type ImportContext, type ImportRow, type InvalidRow } from "./import-rows";
import { runImport, type ImportResult } from "./import-run";

const input = z.object({ orgId: z.uuid(), text: z.string().min(1).max(2_000_000) });

type Fail = { ok: false; error: string };

/** The org's timezone and every hourly space a booking can be imported into:
    active, not equipment (never a primary), with the grid the parser checks. */
async function loadImportContext(orgId: string): Promise<ImportContext | null> {
  const admin = createAdminClient();
  const [{ data: org, error: orgError }, { data: spaces, error: spacesError }] = await Promise.all([
    admin.from("orgs").select("timezone").eq("id", orgId).maybeSingle(),
    admin
      .from("rental_offerings")
      .select("id, name, slot_increment_min, min_duration_min, max_duration_min")
      .eq("org_id", orgId)
      .eq("active", true)
      .eq("range_mode", "hours")
      .neq("kind", "equipment"),
  ]);
  if (orgError) throw orgError;
  if (spacesError) throw spacesError;
  if (!org) return null;
  return {
    timeZone: org.timezone as string,
    spaces: (spaces ?? []).map((s) => ({
      id: s.id as string,
      name: s.name as string,
      slotIncrementMin: s.slot_increment_min as number,
      minDurationMin: s.min_duration_min as number,
      maxDurationMin: s.max_duration_min as number,
    })),
  };
}

async function parseFor(raw: unknown): Promise<{ ready: ImportRow[]; invalid: InvalidRow[] } | Fail> {
  await requireInternal();
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Pick an org and a non-empty CSV file." };
  const ctx = await loadImportContext(parsed.data.orgId);
  if (!ctx) return { ok: false, error: "Org not found." };
  if (ctx.spaces.length === 0) return { ok: false, error: "This org has no active hourly spaces to import into." };
  return parseBookingsCsv(parsed.data.text, ctx);
}

export async function previewBookingsImport(
  raw: unknown,
): Promise<{ ok: true; ready: ImportRow[]; invalid: InvalidRow[] } | Fail> {
  const parsed = await parseFor(raw);
  if ("ok" in parsed) return parsed;
  return { ok: true, ...parsed };
}

export async function runBookingsImport(
  raw: unknown,
): Promise<{ ok: true; results: ImportResult[] } | Fail> {
  const parsed = await parseFor(raw);
  if ("ok" in parsed) return parsed;
  const written = await runImport(createAdminClient(), parsed.ready);
  // One list in spreadsheet order: what was written, what was skipped, and
  // the rows that never qualified.
  const results: ImportResult[] = [
    ...written,
    ...parsed.invalid.map((i) => ({ row: i.row, status: "failed" as const, reason: i.reason })),
  ].sort((a, b) => a.row - b.row);
  return { ok: true, results };
}
