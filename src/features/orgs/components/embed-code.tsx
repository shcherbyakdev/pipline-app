"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { OrgMode } from "@/features/orgs/mode";
import { hasChoice, pickTarget, type EmbedPick, type ShowOptions } from "@/features/orgs/link-rows";
import { LOCALES, LOCALE_NAMES } from "@/i18n/config";
import { bookingLink, embedSrc } from "@/lib/booking/url";
import { copyText } from "@/lib/clipboard";
import { SELECT_CLASS } from "./appearance-fields";
import { embedSnippet, type EmbedTitles } from "./widget-embed-snippet";

/* The code: one snippet, for one target, in one language, in one theme.
   The target (share links, spec 2026-09-16: the page, one person, or ticked
   services / spaces) is a select — Selected services / spaces opens a
   checklist under it. Theme pins light or dark to the host page; the look
   itself is the booking page's (design once, share once). The pick is
   owned by the page so the preview beside the code can follow it; nothing
   is stored, the snippet is the configuration. Three copies: the snippet;
   the widget's bare address, for site builders that embed by URL (Wix,
   Squarespace) rather than by HTML; and the booking-page link for the same
   target. */
export function EmbedCode({
  appUrl,
  handle,
  options,
  pick,
  onPick,
  mode,
  titles,
}: {
  appUrl: string;
  handle: string;
  /** showOptions for the org: its people and its own channel's items. */
  options: ShowOptions;
  pick: EmbedPick;
  onPick: (next: EmbedPick) => void;
  mode: OrgMode;
  /** The iframe titles in the org's language (public.embedTitle.*). */
  titles: EmbedTitles;
}) {
  const t = useTranslations("embed");
  const tc = useTranslations("common");
  const refused = useTranslations("settings")("copyRefused");
  const target = pickTarget(pick, options);
  const lang = pick.lang || undefined;
  const theme = pick.theme || undefined;
  const snippet = embedSnippet(appUrl, handle, target, mode, titles, lang, theme);
  const list = pick.show === "services" ? options.services : pick.show === "spaces" ? options.spaces : null;
  const tick = (id: string, on: boolean) => onPick({ ...pick, ids: on ? [...pick.ids, id] : pick.ids.filter((x) => x !== id) });

  const copy = async (text: string, copied: string) => {
    if (await copyText(text)) toast.success(copied);
    else toast.error(refused);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Solo org, one service or one space: nothing to choose, so no select. */}
      {hasChoice(options) ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="embed-show" className="text-xs font-medium">
            {t("show")}
          </Label>
          <select id="embed-show" className={SELECT_CLASS} value={pick.show} onChange={(e) => onPick({ ...pick, show: e.target.value, ids: [] })}>
            <option value="page">{t("rows.bookingPage")}</option>
            {options.people.length ? (
              <optgroup label={t("badge.team")}>
                {options.people.map((p) => (
                  <option key={p.slug} value={`staff:${p.slug}`}>{p.name}</option>
                ))}
              </optgroup>
            ) : null}
            {options.services.length ? <option value="services">{t("pick.services")}</option> : null}
            {options.spaces.length ? <option value="spaces">{t("pick.spaces")}</option> : null}
          </select>
          {list ? (
            <fieldset className="mt-1 flex flex-col gap-2">
              <legend className="sr-only">{t(pick.show === "services" ? "pick.services" : "pick.spaces")}</legend>
              {list.map((item) => (
                <label key={item.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={pick.ids.includes(item.id)} onCheckedChange={(c) => tick(item.id, c === true)} />
                  {item.name}
                </label>
              ))}
              <p className="text-muted-foreground text-xs">{t("pick.hint")}</p>
            </fieldset>
          ) : null}
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
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="embed-theme" className="text-xs font-medium">
          {t("theme")}
        </Label>
        <select id="embed-theme" className={SELECT_CLASS} value={pick.theme} onChange={(e) => onPick({ ...pick, theme: e.target.value })}>
          <option value="">{t("themes.page")}</option>
          <option value="light">{t("themes.light")}</option>
          <option value="dark">{t("themes.dark")}</option>
        </select>
        <p className="text-muted-foreground text-xs">{t("themeHint")}</p>
      </div>
      {/* Wrapped, not scrolled: the point is to see what you are pasting. */}
      <pre className="bg-card rounded-lg border p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
        {snippet}
      </pre>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => copy(snippet, t("copied"))}>
          {t("copyCode")}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => copy(embedSrc(appUrl, handle, target, lang, theme), t("addressCopied"))}>
          {t("copyAddress")}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => copy(bookingLink(appUrl, handle, target), tc("linkCopied"))}>
          {t("copyPageLink")}
        </Button>
      </div>
    </div>
  );
}
