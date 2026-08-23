"use client";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FieldError, ListEditor } from "../fields";
import { patch, type FormProps } from "./types";

export function FaqForm({ section, issues, onChange }: FormProps<"faq">) {
  return (
    <ListEditor
      items={section.items}
      max={10}
      addLabel="Add question"
      blank={() => ({ q: "", a: "" })}
      onChange={(items) => onChange(patch(section, { items }))}
      render={(item, set, i) => (
        <>
          <Input value={item.q} maxLength={120} placeholder="Question" aria-label={`Question ${i + 1}`} onChange={(e) => set({ ...item, q: e.target.value })} />
          <FieldError message={issues[`items.${i}.q`]} />
          <Textarea value={item.a} maxLength={600} rows={3} placeholder="Answer" aria-label={`Answer ${i + 1}`} onChange={(e) => set({ ...item, a: e.target.value })} />
          <FieldError message={issues[`items.${i}.a`]} />
        </>
      )}
    />
  );
}
