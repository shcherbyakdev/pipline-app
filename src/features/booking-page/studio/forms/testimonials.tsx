"use client";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FieldError, ListEditor } from "../fields";
import { patch, type FormProps } from "./types";

export function TestimonialsForm({ section, issues, onChange }: FormProps<"testimonials">) {
  const t = useTranslations("studio.forms.testimonials");
  return (
    <ListEditor
      items={section.items}
      max={6}
      addLabel={t("add")}
      blank={() => ({ quote: "", author: "" })}
      onChange={(items) => onChange(patch(section, { items }))}
      render={(item, set, i) => (
        <>
          <Textarea value={item.quote} maxLength={300} rows={3} placeholder={t("quotePlaceholder")} aria-label={t("quoteAria", { n: i + 1 })} onChange={(e) => set({ ...item, quote: e.target.value })} />
          <FieldError message={issues[`items.${i}.quote`]} />
          <Input value={item.author} maxLength={60} placeholder={t("authorPlaceholder")} aria-label={t("authorAria", { n: i + 1 })} onChange={(e) => set({ ...item, author: e.target.value })} />
          <FieldError message={issues[`items.${i}.author`]} />
        </>
      )}
    />
  );
}
