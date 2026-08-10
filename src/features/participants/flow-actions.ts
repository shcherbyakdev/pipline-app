"use server";

import { createHash, randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createAnonServerClient } from "@/lib/supabase/anon-server";
import { resolveParticipantToken, clientKeyFrom } from "@/lib/tokens";
import { evidencePathFor, isAllowedPhotoType, PHOTO_MAX_BYTES } from "@/lib/storage/photo";
import { uploadEvidenceObject, deleteEvidenceObject } from "@/lib/storage/evidence";
import {
  participantSaveResponseInput,
  participantClearResponseInput,
  uploadPhotoInput,
  removePhotoInput,
  GENERIC_WRITE_ERROR,
  type ActionState,
} from "./schema";

// Participant writes ride the anon-callable RPCs — the token is the
// credential and SQL is the authority. Failures are uniform: no message
// distinguishes "bad token" from "out of scope" (the 404 discipline).
// NEVER log the token.
export async function submitResponse(input: unknown): Promise<ActionState> {
  const parsed = participantSaveResponseInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const d = parsed.data;
  const anon = createAnonServerClient();
  const { error } = await anon.rpc("submit_participant_response", {
    p_token: d.token,
    p_unit_id: d.unitId,
    p_requirement_id: d.requirementId,
    p_value_text: d.type === "text" || d.type === "choice" ? d.value : null,
    p_value_number: d.type === "number" ? d.value : null,
    p_value_bool: d.type === "boolean" ? d.value : null,
    p_value_date: d.type === "date" ? d.value : null,
  });
  if (error) {
    // `??` would miss this: a transport failure (timeout/abort/network) comes
    // back with error.code === "" (empty, not nullish), so `??` never falls
    // through and the log line goes blank in exactly the case that needs a
    // diagnostic. `||` falls through empty-string code to message.
    console.error("[participants] submitResponse:", error.code || error.message || "rpc error");
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  revalidatePath(`/p/${d.token}`);
  revalidatePath(`/p/${d.token}/units/${d.unitId}`);
  return { ok: true };
}

export async function clearResponse(input: unknown): Promise<ActionState> {
  const parsed = participantClearResponseInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const d = parsed.data;
  const anon = createAnonServerClient();
  const { error } = await anon.rpc("clear_participant_response", {
    p_token: d.token,
    p_unit_id: d.unitId,
    p_requirement_id: d.requirementId,
  });
  if (error) {
    console.error("[participants] clearResponse:", error.code || error.message || "rpc error");
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  revalidatePath(`/p/${d.token}`);
  revalidatePath(`/p/${d.token}/units/${d.unitId}`);
  return { ok: true };
}

// Server-relay upload: resolve the token FIRST (the path prefix comes from
// the resolved scope), hash the exact bytes we store, upload, then let the
// RPC re-check scope and record the row. Object-before-row ordering means a
// definitively-rejected RPC leaves at worst an invisible orphan object
// (compensated below) — never a row pointing at nothing. See the asymmetric
// compensation logic below for the indeterminate-outcome case.
export async function uploadPhoto(formData: FormData): Promise<ActionState> {
  const parsed = uploadPhotoInput.safeParse({
    token: formData.get("token"),
    unitId: formData.get("unitId"),
    requirementId: formData.get("requirementId"),
  });
  const file = formData.get("file");
  if (!parsed.success || !(file instanceof File)) {
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  if (file.size === 0 || file.size > PHOTO_MAX_BYTES || !isAllowedPhotoType(file.type)) {
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  const d = parsed.data;

  const resolved = await resolveParticipantToken(d.token, clientKeyFrom(await headers()));
  if (resolved.status !== "ok") return { ok: false, error: GENERIC_WRITE_ERROR };
  const scope = resolved.scope;

  const bytes = await file.arrayBuffer();
  // Re-check against the actual buffered bytes, not just the File's reported
  // size — and record/hash from the same source below, so the checksum and
  // the size we tell the database provably describe the same buffer.
  if (bytes.byteLength === 0 || bytes.byteLength > PHOTO_MAX_BYTES) {
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  const checksum = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
  const path = evidencePathFor(scope.orgId, scope.programId, d.unitId, randomUUID(), file.type);
  if (!path) return { ok: false, error: GENERIC_WRITE_ERROR };

  if (!(await uploadEvidenceObject(path, bytes, file.type))) {
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }

  const anon = createAnonServerClient();
  const { error, status } = await anon.rpc("record_photo_evidence", {
    p_token: d.token,
    p_unit_id: d.unitId,
    p_requirement_id: d.requirementId,
    p_path: path,
    p_filename: file.name.slice(0, 200) || "photo",
    p_mime: file.type,
    p_size_bytes: bytes.byteLength,
    p_checksum_sha256: checksum,
  });
  if (error) {
    console.error("[participants] uploadPhoto:", error.code || error.message || "rpc error");
    // Only compensate on a DEFINITE server-side rejection: a non-empty
    // error.code, or an HTTP status the server actually sent (>=400), means
    // Postgres answered and refused — the row was never committed, so the
    // object is a genuine orphan and safe to delete. A transport failure
    // (timeout/abort/network drop) comes back with code "" and status 0: we
    // then have NO idea whether the row committed before the response was
    // lost. Deleting the object in that case is exactly the corruption this
    // object-before-row ordering exists to prevent (a committed evidence row
    // pointing at a missing object) — so on an indeterminate outcome we
    // deliberately leave the object as an orphan, the same cheap accepted
    // wart deleteEvidenceObject already carries elsewhere. Do not "simplify"
    // this back to an unconditional delete.
    if (error.code || status >= 400) {
      await deleteEvidenceObject(path);
    }
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  revalidatePath(`/p/${d.token}`);
  revalidatePath(`/p/${d.token}/units/${d.unitId}`);
  return { ok: true };
}

// Row first (the RPC is the authority and returns the path), object second;
// a failed object delete is a logged, accepted orphan.
export async function removePhoto(input: unknown): Promise<ActionState> {
  const parsed = removePhotoInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const d = parsed.data;
  const anon = createAnonServerClient();
  const { data, error } = await anon.rpc("delete_photo_evidence", {
    p_token: d.token,
    p_evidence_id: d.evidenceId,
  });
  if (error) {
    console.error("[participants] removePhoto:", error.code || error.message || "rpc error");
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  if (typeof data === "string" && data.length > 0) {
    await deleteEvidenceObject(data);
  } else {
    // evidence.path is NOT NULL, so a missing/empty path here means the RPC
    // contract broke, not a legitimate empty case — log so an orphaned
    // object doesn't leak silently. Never logs the token.
    console.error("[participants] removePhoto: RPC returned no evidence path — invariant violated");
  }
  revalidatePath(`/p/${d.token}`);
  revalidatePath(`/p/${d.token}/units/${d.unitId}`);
  return { ok: true };
}
