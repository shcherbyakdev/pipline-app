"use client";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { LINK_ICONS, type LinkIcon } from "../../schema";
import { FieldError, ListEditor, SELECT_CLASS } from "../fields";
import { patch, type FormProps } from "./types";

const PLACEHOLDER: Record<LinkIcon, string> = {
  instagram: "https://instagram.com/…", facebook: "https://facebook.com/…", tiktok: "https://tiktok.com/@…",
  whatsapp: "https://wa.me/48…", website: "https://…", phone: "tel:+48…", email: "mailto:you@example.com", other: "https://…",
};

export function LinksForm({ section, issues, onChange }: FormProps<"links">) {
  const t = useTranslations("studio.forms.links");
  return (
    <ListEditor
      items={section.items}
      max={8}
      addLabel={t("add")}
      blank={() => ({ label: "", url: "", icon: "website" as const })}
      onChange={(items) => onChange(patch(section, { items }))}
      render={(item, set, i) => (
        <>
          <div className="flex gap-2">
            <select value={item.icon} aria-label={t("typeAria", { n: i + 1 })} className={SELECT_CLASS} onChange={(e) => set({ ...item, icon: e.target.value as LinkIcon })}>
              {LINK_ICONS.map((icon) => (
                <option key={icon} value={icon}>{t(`icon.${icon}`)}</option>
              ))}
            </select>
            <Input value={item.label} maxLength={40} placeholder={t("label")} aria-label={t("labelAria", { n: i + 1 })} onChange={(e) => set({ ...item, label: e.target.value })} />
          </div>
          <FieldError message={issues[`items.${i}.label`]} />
          <Input value={item.url} maxLength={500} placeholder={PLACEHOLDER[item.icon]} aria-label={t("addressAria", { n: i + 1 })} onChange={(e) => set({ ...item, url: e.target.value })} />
          <FieldError message={issues[`items.${i}.url`]} />
        </>
      )}
    />
  );
}
