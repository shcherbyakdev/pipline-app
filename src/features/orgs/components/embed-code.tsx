"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { OrgMode } from "@/features/orgs/mode";
import type { LinkRow } from "@/features/orgs/link-rows";
import { LOCALES, LOCALE_NAMES } from "@/i18n/config";
import { bookingLink, embedSrc } from "@/lib/booking/url";
import { copyText } from "@/lib/clipboard";
import { SELECT_CLASS } from "./appearance-fields";
import { embedSnippet, type EmbedTitles } from "./widget-embed-snippet";

/** What the Code tab points the snippet at: a linkRows key and a language
    ("" = follow the visitor). Owned by the page so the preview beside the
    code can follow both. Neither is stored — they are part of the string
    you copy, so one site can embed the team in English and another one
    person in Ukrainian. */
export type EmbedPick = { key: string; lang: string };

/* The Code tab: one snippet, for one target, in one language. The target
   (admin IA spec §5: the page, one person, one service or one space) is the
   old Links & embeds table folded into a select, its rows still from
   linkRows, grouped by kind. Three copies: the snippet; the widget's bare
   address, for site builders that embed by URL (Wix, Squarespace) rather
   than by HTML; and the booking-page link for the same target. */
export function EmbedCode({
  appUrl,
  handle,
  rows,
  pick,
  onPick,
  mode,
  titles,
}: {
  appUrl: string;
  handle: string;
  /** linkRows for the org — the page row first, then only its own channel. */
  rows: readonly LinkRow[];
  pick: EmbedPick;
  onPick: (next: EmbedPick) => void;
  mode: OrgMode;
  /** The iframe titles in the org's language (public.embedTitle.*). */
  titles: EmbedTitles;
}) {
  const t = useTranslations("embed");
  const tc = useTranslations("common");
  const refused = useTranslations("settings")("copyRefused");
  const row = rows.find((r) => r.key === pick.key) ?? rows[0];
  const lang = pick.lang || undefined;
  const snippet = embedSnippet(appUrl, handle, row.target, mode, titles, lang);
  const name = (r: LinkRow) => ("key" in r.label ? t(`rows.${r.label.key}`) : r.label.name);
  const kinds = ["team", "service", "space"] as const;

  const copy = async (text: string, copied: string) => {
    if (await copyText(text)) toast.success(copied);
    else toast.error(refused);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t("paste")}</p>
      {/* Solo org, one service: nothing to choose, so no select. */}
      {rows.length > 1 ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="embed-show" className="text-xs font-medium">
            {t("show")}
          </Label>
          <select id="embed-show" className={SELECT_CLASS} value={row.key} onChange={(e) => onPick({ ...pick, key: e.target.value })}>
            {rows.filter((r) => !r.badge).map((r) => (
              <option key={r.key} value={r.key}>{name(r)}</option>
            ))}
            {kinds.map((kind) => {
              const group = rows.filter((r) => r.badge === kind);
              return group.length ? (
                <optgroup key={kind} label={t(`badge.${kind}`)}>
                  {group.map((r) => (
                    <option key={r.key} value={r.key}>{name(r)}</option>
                  ))}
                </optgroup>
              ) : null;
            })}
          </select>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="embed-lang" className="text-xs font-medium">
          {t("language")}
        </Label>
        <select id="embed-lang" className={SELECT_CLASS} value={pick.lang} onChange={(e) => onPick({ ...pick, lang: e.target.value })}>
          <option value="">{t("languageAuto")}</option>
          {/* LOCALE_NAMES: each language named in itself, never translated. */}
          {LOCALES.map((l) => (
            <option key={l} value={l}>{LOCALE_NAMES[l]}</option>
          ))}
        </select>
      </div>
      {/* Wrapped, not scrolled: the point is to see what you are pasting. */}
      <pre className="bg-card rounded-lg border p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
        {snippet}
      </pre>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => copy(snippet, t("copied"))}>
          {t("copyCode")}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => copy(embedSrc(appUrl, handle, row.target, lang), t("addressCopied"))}>
          {t("copyAddress")}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => copy(bookingLink(appUrl, handle, row.target), tc("linkCopied"))}>
          {tc("copyLink")}
        </Button>
      </div>
    </div>
  );
}
