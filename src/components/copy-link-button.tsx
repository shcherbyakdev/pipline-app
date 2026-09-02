"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";

/** What a list row needs to build its own booking link; null when the org
    has no handle yet (then no row shows a button). */
export type LinkBase = { appUrl: string; handle: string };

/* "Copy link" on a Services / Spaces row (admin IA spec §5): the Team page's
   ghost button idiom, plus a link glyph so the row reads at a glance. `name`
   gives the button its own accessible name (WCAG 2.5.3 label-in-name) — a
   page can have many of these rows, and "Copy link" alone would not tell
   them apart. */
export function CopyLinkButton({ url, name }: { url: string; name: string }) {
  const t = useTranslations("common");
  const refused = useTranslations("settings")("copyRefused");
  const copy = async () => {
    if (await copyText(url)) toast.success(t("linkCopied"));
    else toast.error(refused);
  };
  return (
    <Button variant="ghost" size="xs" onClick={copy} aria-label={`${t("copyLink")} — ${name}`}>
      <HugeiconsIcon icon={Link01Icon} size={14} className="shrink-0" aria-hidden />
      {t("copyLink")}
    </Button>
  );
}
