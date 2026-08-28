"use client";

import * as React from "react";
import { toast } from "sonner";
import { saveBookingPageDraft, publishBookingPage, discardBookingPageDraft } from "../actions";
import { GENERIC_WRITE_ERROR } from "@/lib/actions";
import { pageDocumentSchema, type PageDocument } from "../schema";
import { DEFAULT_PAGE } from "../defaults";
import { deepEqual, hasUnpublishedChanges, issuesBySection, type IssueMap } from "../doc-ops";
import type { PageChannel } from "../channel";

export type SaveStatus = "idle" | "saving" | "saved" | "error" | "invalid";
const AUTOSAVE_MS = 800;

/* The studio's draft: local state first (the preview follows instantly),
   autosave debounced, the whole document validated before every write so the
   RPC only ever sees valid documents. Publish sends the current local doc
   (the action saves then publishes); discard reverts to the last published
   document, or the default page when never published.
   The page's channel rides every write; the hook never switches pages — the
   builder is re-mounted per ?page= (booking-page/page.tsx). */
export function usePageDraft(initial: { draft: PageDocument; published: PageDocument | null }, channel: PageChannel) {
  const [doc, setDoc] = React.useState(initial.draft);
  const [published, setPublished] = React.useState(initial.published);
  const [status, setStatus] = React.useState<SaveStatus>("idle");
  // Has update() ever run? `status` alone can't say "unsaved": it starts at
  // "idle" for a freshly loaded (and therefore saved) draft.
  const [edited, setEdited] = React.useState(false);
  const [issues, setIssues] = React.useState<IssueMap>({});
  const [busy, startTransition] = React.useTransition();
  const docRef = React.useRef(doc);
  const lastSaved = React.useRef(initial.draft);
  const timer = React.useRef<number | null>(null);
  // The autosave request in flight, if any. Held as a promise (not a flag) so
  // publish/discard can wait for it: an older autosave landing AFTER a
  // publish or discard would re-install stale draft content server-side.
  const inFlight = React.useRef<Promise<void> | null>(null);
  const flushAgain = React.useRef(false);
  const mounted = React.useRef(false);

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

  // Unmount path: no state, no transition — just get the bytes to the server.
  // Invalid documents are dropped (the RPC would refuse them anyway).
  const saveDetached = React.useCallback((candidate: PageDocument) => {
    const parsed = pageDocumentSchema.safeParse(candidate);
    if (!parsed.success || deepEqual(parsed.data, lastSaved.current)) return;
    lastSaved.current = parsed.data;
    void saveBookingPageDraft({ channel, doc: parsed.data }).catch((error) => {
      console.error("[booking-page] detached autosave threw:", error);
    });
  }, [channel]);

  const flush = React.useCallback(() => {
    clearTimer();
    if (inFlight.current) {
      // A save is in flight: run once more when it settles, never concurrently —
      // out-of-order responses would otherwise regress lastSaved.
      flushAgain.current = true;
      return;
    }
    const valid = validate(docRef.current);
    if (!valid) return;
    if (deepEqual(valid, lastSaved.current)) {
      setStatus("saved");
      return;
    }
    setStatus("saving");
    const run = (async () => {
      try {
        const result = await saveBookingPageDraft({ channel, doc: valid });
        if (result.ok) {
          lastSaved.current = valid;
          setStatus(deepEqual(docRef.current, valid) ? "saved" : "idle");
        } else {
          setStatus("error");
          toast.error(result.error);
        }
      } catch (error) {
        console.error("[booking-page] autosave threw:", error);
        setStatus("error");
        toast.error(GENERIC_WRITE_ERROR);
      } finally {
        inFlight.current = null;
        if (flushAgain.current) {
          flushAgain.current = false;
          // The studio may have unmounted while this save ran — the queued
          // edit still has to reach the server, just without touching state.
          if (mounted.current) flush();
          else saveDetached(docRef.current);
        }
      }
    })();
    inFlight.current = run;
    // `busy` (isPending) tracks the request; the promise itself never rejects.
    startTransition(async () => {
      await run;
    });
  }, [validate, clearTimer, startTransition, saveDetached, channel]);

  // Wait for whatever autosave is running (and any re-run it queues) before a
  // write that must not be overtaken. A queued re-flush is dropped first:
  // publish/discard write the document themselves.
  const settle = React.useCallback(async () => {
    flushAgain.current = false;
    while (inFlight.current) await inFlight.current;
  }, []);

  const update = React.useCallback(
    (next: PageDocument | ((prev: PageDocument) => PageDocument)) => {
      const resolved = typeof next === "function" ? next(docRef.current) : next;
      docRef.current = resolved;
      setDoc(resolved);
      setEdited(true);
      setStatus("idle");
      clearTimer();
      timer.current = window.setTimeout(flush, AUTOSAVE_MS);
    },
    [flush, clearTimer],
  );

  // Unmount: an edit made inside the debounce window would otherwise be lost
  // (the draft is re-read on next visit). Fire it; if a save is in flight its
  // `finally` sends the latest document instead, so the two never race.
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimer();
      if (inFlight.current) flushAgain.current = true;
      else saveDetached(docRef.current);
    };
  }, [clearTimer, saveDetached]);

  // Closing the tab mid-debounce or mid-save: let the browser ask first.
  // Every path that brings the server level with the local doc ends in
  // status "saved"; anything else after an edit is unsaved.
  const unsaved = edited && status !== "saved";
  React.useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy browsers key off returnValue; modern ones off preventDefault.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  const publish = React.useCallback(() => {
    clearTimer();
    const valid = validate(docRef.current);
    if (!valid) {
      toast.error("Fix the highlighted fields before publishing.");
      return;
    }
    setStatus("saving");
    startTransition(async () => {
      try {
        await settle();
        const result = await publishBookingPage({ channel, doc: valid });
        if (!result.ok) {
          setStatus("error");
          toast.error(result.error);
          return;
        }
        lastSaved.current = valid;
        setPublished(valid);
        setStatus(deepEqual(docRef.current, valid) ? "saved" : "idle");
        toast.success("Page published");
      } catch (error) {
        console.error("[booking-page] publish threw:", error);
        setStatus("error");
        toast.error(GENERIC_WRITE_ERROR);
      }
    });
  }, [validate, clearTimer, startTransition, settle, channel]);

  const discard = React.useCallback(() => {
    clearTimer();
    startTransition(async () => {
      try {
        await settle();
        const result = await discardBookingPageDraft({ channel });
        // No "error" status here: discard has no retry affordance, the toast is the whole signal.
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
      } catch (error) {
        console.error("[booking-page] discard threw:", error);
        toast.error(GENERIC_WRITE_ERROR);
      }
    });
  }, [published, clearTimer, startTransition, settle, channel]);

  return {
    doc, update, published, status, issues, busy,
    retry: flush, publish, discard,
    unpublished: hasUnpublishedChanges(doc, published),
  };
}

export type PageDraft = ReturnType<typeof usePageDraft>;
