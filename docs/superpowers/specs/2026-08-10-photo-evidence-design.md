# Photo Evidence — Slice 8 Design

**Date:** 2026-08-10
**Status:** Approved in brainstorm.
**Parent:** `2026-08-09-client-flow-vision-and-roadmap-design.md` (slice 8 —
thesis-critical). Builds on slice 6 (requirements, derivation) and slice 7
(participants, tokens, anon RPCs).

## Goal

A photo from a phone lands in the unit's record with checksum and
attribution. The participant flow gains photo upload; the console displays
what arrived; a photo requirement satisfies itself the way scalar
requirements already do. This closes the last requirement type that slice 6
left dangling (`photo` is in the type CHECKs but excluded from the editor
and from derivation).

## Decisions inherited from the vision spec (not revisited)

Evidence is **metadata only** — the row is the compliance record;
`provider` exists from day one ('supabase' in v1, BYO post-v1). Photo is
satisfied by ≥1 `evidence` row linked via `response_id`. Photos go to
Supabase Storage, path `org_id/program_id/unit_id/...`, size limit
enforced. EXIF/GPS is kept — a geotag is a feature, not a leak. Never the
vault: photos and structured fields only, no arbitrary documents, no
identity documents.

## Decisions made in this brainstorm

| Decision | Choice | Rejected |
|---|---|---|
| Upload scope | **Participant-only**; console is display-only | Staff upload path (second write path + grants + tests; override already covers out-of-band photos) |
| Satisfaction | **≥1 photo, no config.** "Two photos" = two labeled photo requirements — the label tells the engineer *what* to photograph | `config.minPhotos` (second knob, vaguer prompts) |
| EXIF this slice | **Keep bytes untouched, parse nothing.** Original file stored as-is; geotag chip is a follow-up that loses nothing by waiting | Parsing EXIF now (library + edge cases before the display exists) |
| Participant delete | **While the stage is pending** (mirrors "editable until done"); locked once done | No delete (blurry photo permanently satisfies); staff delete (wider surface) |
| Transport | **Server-relay:** FormData → Next server → resolve token → sha256 → admin-client upload → definer RPC records the row. One round trip; checksum computed over the bytes actually stored; bucket stays private with **zero** storage policies | Signed-URL direct upload (2–3 round trips on flaky site connectivity, orphan cleanup, client-claimed checksum). Right shape at deploy scale; `evidence.provider` means no rewrite. Anon storage RLS (cannot scope to a token without duplicating the validator) |
| Compression | **None.** Client re-encode strips EXIF, which "kept" forbids. Originals upload in a few seconds on 4G; 15MB cap | Canvas downscale before upload |

## Data model

```
evidence                               -- metadata only; the row is the record
  id uuid PK, org_id FK→orgs (cascade),
  unit_id FK→units (cascade), unit_stage_id FK→unit_stages (cascade),
  response_id FK→unit_stage_responses ON DELETE SET NULL,   -- nullable by design
  provider text NOT NULL CHECK in ('supabase') DEFAULT 'supabase',
  path text NOT NULL,                  -- storage object path, server-chosen
  filename text NOT NULL,             -- original client filename, display only
  mime text NOT NULL, size_bytes bigint NOT NULL,
  checksum_sha256 text NOT NULL,      -- computed server-side over stored bytes
  uploaded_by_participant_id FK→participants ON DELETE SET NULL,
  uploaded_by_user_id uuid NULL,      -- staff path is post-v1; column exists now
  created_at timestamptz
  INDEX (org_id), (unit_id), (unit_stage_id), (response_id)
  RLS: member select via org_id. NO client writes on either API role —
  rows are written only inside the definer RPCs. Explicit GRANTs
  (authenticated: select only) in the same migration.
```

**`unit_stage_responses` CHECK relaxed:** `type='photo'` with all four
value columns NULL becomes valid — this is the wiring slice 6 explicitly
deferred ("photo requirements get no response row until slice 8"). The
photo response row is the uniform "answered" anchor: created by the record
RPC on first upload, carries `answered_by_participant_id`, deleted by the
delete RPC when the last photo goes. Scalar all-null stays forbidden.

**Derivation extended:** `satisfied(photo) := a response row exists AND
≥1 evidence row with response_id = response.id`. A new `AFTER INSERT OR
DELETE` trigger on `evidence` recomputes the parent unit_stage — the
existing responses-trigger pattern, minus UPDATE (evidence rows are
immutable). Cascade deletes are handled the way the slice 6 derivation
already handles them.

## SQL surface (one migration, the 0011 discipline)

```
record_photo_evidence(p_token, p_requirement_id, p_unit_id, p_path,
                      p_filename, p_mime, p_size_bytes, p_checksum) → uuid
  SECURITY DEFINER; execute granted to anon ONLY (revoked from
  public/authenticated/service_role — the submit_participant_response
  lockdown).
  1. resolve_participant_token; anything but 'ok' → 'link not found'.
  2. requirement must be photo-type, on a unit IN SCOPE NOW, and its
     unit_stage must be 'pending' (mirrors "editable until done") —
     no match → 'requirement not found' (404-shaped).
  3. PATH-PREFIX CHECK: p_path must start with
     '<org_id>/<program_id>/<unit_id>/' taken from the RESOLVED scope,
     never from the caller.
  4. Upsert the all-null photo response row (attribution :=
     scope.participant_id; the slice 6 trust trigger fills the
     denormalized columns), insert the evidence row. Derivation fires.

delete_photo_evidence(p_token, p_evidence_id) → text   -- the storage path
  Same shape: token 'ok'; evidence row in scope NOW; unit_stage still
  'pending' — else 404-shaped failure. Deletes the evidence row; if it was
  the last for its response, deletes the response row too (stage
  re-derives). Returns the path so the server action can delete the object
  afterward.

Guards on existing RPCs: submit_participant_response and
clear_participant_response reject photo-type requirements ('requirement
not found' shape) — photos have their own lifecycle; a scalar path must
not delete a response that anchors evidence.
```

**Why anon-callable stays safe.** A direct PostgREST caller holding a
valid token can only write evidence inside their own unit's path prefix
(step 3). Worst case they fabricate a row pointing at a nonexistent object
in their own folder — equivalent to uploading a garbage photo; it corrupts
only their own record. Without the prefix check they could set `path` to
another org's object and have *their* console mint a signed URL for it —
that cross-tenant read is the attack the check exists to kill. The
256-bit-entropy boundary and the 404 discipline are unchanged from
slice 7.

## Storage

- Private bucket **`evidence`**, created by migration, with
  `file_size_limit` = 15MB and `allowed_mime_types` = jpeg/png/webp/heic/heif.
  **Zero storage RLS policies** — every object read/write goes through the
  server-only service-role client (`lib/supabase/admin.ts`).
- Object path: `org_id/program_id/unit_id/<uuid>.<ext>` — server-generated
  (collision-free); the original filename lives on the evidence row.
- Original bytes stored untouched; EXIF (including GPS) survives inside
  the file for the follow-up slice to surface.
- Reads everywhere (console and participant flow) are short-lived signed
  URLs minted in server components after the usual scope checks — console
  via member RLS on `evidence`, flow via the `lib/tokens` scoped readers.
- Known v1 wart, accepted and documented: storage objects are **not**
  garbage-collected when a unit/program/org is deleted — metadata rows
  cascade, objects remain until a post-v1 cleanup job.

## The upload action (`uploadPhoto` in `features/participants/flow-actions.ts`)

1. Parse FormData (token, unitId, requirementId, file) with Zod: mime
   allowlist, ≤15MB, filename length cap.
2. Resolve the token via `lib/tokens` (rate-limited, the only place that
   touches tokens). Not 'ok' → generic failure.
3. sha256 the bytes; build the path from the RESOLVED scope +
   `crypto.randomUUID()`.
4. Upload via the admin client (`upsert: false`, contentType set).
5. Call `record_photo_evidence`. On RPC failure → compensating object
   delete (orphan on double-failure is logged and accepted; an evidence
   row pointing at a missing object is NOT acceptable, so the row is
   written last).
6. Revalidate the flow paths.

`removePhoto` mirrors it: `delete_photo_evidence` first (DB row gone), then
admin-client object delete (failure → logged orphan, accepted).

`serverActions.bodySizeLimit` raised to ~16MB in `next.config.ts` — exact
option name/shape verified against `node_modules/next/dist/docs/` during
planning (AGENTS.md: this Next version differs from training data).

## Surfaces

**Template editor** (`/templates/[id]`): the type select gains **photo**
(no config input — a photo requirement is just a label). The snapshot
already copies it verbatim; `program_stage_requirements` already admits
the type.

**Participant flow** (`/p/[token]/units/[unitId]`): the shared requirement
field component gains a photo renderer — uploaded thumbnails (signed URLs)
each with a remove control while the stage is pending, plus an **Add
photo** button (`<input type="file" accept="image/*"
capture="environment">`). Multiple photos per requirement allowed.
In-flight upload state rides the existing optimistic `applyEvent` pattern.
Done stages collapse to the read-only summary as today — thumbnails
visible, no controls.

**Console unit page** (`/programs/[id]/units/[unitId]`): display-only —
thumbnails with filename, size, uploader, time; click opens the full-size
signed URL in a new tab. No photos yet → "Awaiting photo". The stage chip
needs no new logic (`unit_stages.status` stays the derived truth); only
the per-requirement satisfied count in the page query learns that photo
satisfaction reads evidence rows, not value columns.

**Matrix** (`/programs/[id]`): untouched — dots read `unit_stages.status`.

**New/changed files** (feature-sliced, `app/` stays thin):

```
src/features/participants/flow-actions.ts        (+uploadPhoto, +removePhoto)
src/features/participants/schema.ts              (+upload/remove Zod inputs)
src/lib/tokens/index.ts                          (readers gain evidence + signed URLs)
src/features/programs/components/requirement-field.tsx (photo case, both surfaces)
src/features/programs/queries.ts                 (unit page query gains evidence)
src/features/templates/…                         (editor type select gains photo)
src/db/schema/evidence.ts                        (new table)
src/db/migrations/0014_*.sql, 0015_evidence_rls.sql  (generated + custom:
  RLS, GRANTs, bucket, RPCs, CHECK relaxation, evidence trigger, RPC guards)
next.config.ts                                   (bodySizeLimit)
```

## Error handling

Existing conventions unchanged: `{ ok, error }` + `GENERIC_WRITE_ERROR`;
404-shaped scope failures, never 403, never distinguishing bad-token from
out-of-scope; tokens never logged. Upload-specific: the client hints
oversize/wrong-type before any bytes move; the server rejects the same
twice (Zod at the edge, bucket limits at the floor). Storage/RPC errors
log codes only. Compensation ordering as in the upload action above.

## Testing

- **Unit (Vitest):** upload/remove Zod inputs (mime allowlist, size cap,
  filename length), path construction, checksum helper.
- **Integration** (through the real surfaces — anon supabase-js, no
  session):
  - Record: valid token → evidence row + all-null photo response with
    `answered_by_participant_id`; derivation completes a stage whose only
    required requirement is the photo; optional photo doesn't block.
  - **The core scope test extended:** a token for unit A cannot record or
    delete evidence on unit B; a program-scoped token cannot touch an
    unassigned unit.
  - Path prefix: RPC rejects a path outside the resolved
    `org/program/unit/` prefix.
  - Delete: removing the last photo deletes the response row and reopens
    the stage; delete on a done stage rejected; foreign evidence id
    rejected; non-last delete keeps the response and the stage done.
  - Guards: submit/clear RPCs reject photo-type requirements.
  - CHECK: all-null valid only for `type='photo'`; scalar all-null still
    rejected.
  - RLS/grants: org B member cannot select org A evidence; anon cannot
    select evidence; neither API role can insert/update/delete evidence
    directly; authenticated cannot execute the new RPCs.
- **Manual (the demo motion):** phone → add two photos → stage flips done
  → console shows them with checksum + attribution.

## Out of scope (deliberate)

Staff upload/delete (override covers out-of-band photos), EXIF/geotag
parsing and display (follow-up; bytes preserved), image
compression/thumbnails (full-size signed URLs in `<img>` are fine at v1
scale), storage GC on deletion, lightbox, non-image evidence, BYO storage
providers (the `provider` column waits), min-photo-count config, portal
photo display (slice 9), chasing on missing photos (slice 10).
