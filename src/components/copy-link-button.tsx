"use client";

import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";

/** What a list row needs to build its own booking link; null when the org
    has no handle yet (then no row shows a button). */
export type LinkBase = { appUrl: string; handle: string };

export const COPY_REFUSED = "Couldn't copy — select the link text and copy manually.";

/* "Copy link" on a Services / Spaces row (admin IA spec §5): the Team page's
   ghost button idiom, plus a link glyph so the row reads at a glance. */
export function CopyLinkButton({ url }: { url: string }) {
  const copy = async () => {
    if (await copyText(url)) toast.success("Copied");
    else toast.error(COPY_REFUSED);
  };
  return (
    <Button variant="ghost" size="xs" onClick={copy} aria-label="Copy booking link">
      <HugeiconsIcon icon={Link01Icon} size={14} className="shrink-0" aria-hidden />
      Copy link
    </Button>
  );
}
