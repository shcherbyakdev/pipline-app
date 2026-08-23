"use client";

import * as React from "react";
import { toast } from "sonner";
import { saveBookingPageDraft, publishBookingPage, discardBookingPageDraft } from "../actions";
import { pageDocumentSchema, type PageDocument } from "../schema";
import { DEFAULT_PAGE } from "../defaults";
import { deepEqual, hasUnpublishedChanges, issuesBySection, type IssueMap } from "../doc-ops";

export type SaveStatus = "idle" | "saving" | "saved" | "error" | "invalid";
const AUTOSAVE_MS = 800;

/* The studio's draft: local state first (the preview follows instantly),
   autosave debounced, the whole document validated before every write so the
   RPC only ever sees valid documents. Publish sends the current local doc
   (the action saves then publishes); discard reverts to the last published
   document, or the default page when never published. */
export function usePageDraft(initial: { draft: PageDocument; published: PageDocument | null }) {
  const [doc, setDoc] = React.useState(initial.draft);
  const [published, setPublished] = React.useState(initial.published);
  const [status, setStatus] = React.useState<SaveStatus>("idle");
  const [issues, setIssues] = React.useState<IssueMap>({});
  const [busy, startTransition] = React.useTransition();
  const docRef = React.useRef(doc);
  const lastSaved = React.useRef(initial.draft);
  const timer = React.useRef<number | null>(null);

  const clearTimer = React.useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const validate = React.useCallback((candidate: PageDocument): PageDocument | null => {
    const parsed = pageDocumentSchema.safeParse(candidate);
    if (parsed.success) {
      setIssues({});
      return parsed.data;
    }
    setIssues(issuesBySection(candidate, parsed.error.issues));
    setStatus("invalid");
    return null;
  }, []);

  const flush = React.useCallback(() => {
    clearTimer();
    const valid = validate(docRef.current);
    if (!valid) return;
    if (deepEqual(valid, lastSaved.current)) {
      setStatus("saved");
      return;
    }
    setStatus("saving");
    startTransition(async () => {
      const result = await saveBookingPageDraft(valid);
      if (result.ok) {
        lastSaved.current = valid;
        // Edits may have landed while saving: then we are "idle" with a timer pending.
        setStatus(deepEqual(docRef.current, valid) ? "saved" : "idle");
      } else {
        setStatus("error");
        toast.error(result.error);
      }
    });
  }, [validate, clearTimer, startTransition]);

  const update = React.useCallback(
    (next: PageDocument | ((prev: PageDocument) => PageDocument)) => {
      const resolved = typeof next === "function" ? next(docRef.current) : next;
      docRef.current = resolved;
      setDoc(resolved);
      setStatus("idle");
      clearTimer();
      timer.current = window.setTimeout(flush, AUTOSAVE_MS);
    },
    [flush, clearTimer],
  );

  // Unmount: drop a pending autosave (the draft is re-read on next visit).
  React.useEffect(() => clearTimer, [clearTimer]);

  const publish = React.useCallback(() => {
    clearTimer();
    const valid = validate(docRef.current);
    if (!valid) {
      toast.error("Fix the highlighted fields before publishing.");
      return;
    }
    setStatus("saving");
    startTransition(async () => {
      const result = await publishBookingPage(valid);
      if (!result.ok) {
        setStatus("error");
        toast.error(result.error);
        return;
      }
      lastSaved.current = valid;
      setPublished(valid);
      setStatus("saved");
      toast.success("Page published");
    });
  }, [validate, clearTimer, startTransition]);

  const discard = React.useCallback(() => {
    clearTimer();
    startTransition(async () => {
      const result = await discardBookingPageDraft();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const restored = published ?? DEFAULT_PAGE;
      docRef.current = restored;
      lastSaved.current = restored;
      setDoc(restored);
      setIssues({});
      setStatus("saved");
      toast.success("Draft discarded");
    });
  }, [published, clearTimer, startTransition]);

  return {
    doc, update, published, status, issues, busy,
    retry: flush, publish, discard,
    unpublished: hasUnpublishedChanges(doc, published),
  };
}

export type PageDraft = ReturnType<typeof usePageDraft>;
