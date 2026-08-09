import { notFound } from "next/navigation";
import { getTemplate } from "@/features/templates/queries";
import { TemplateHeader } from "@/features/templates/components/template-header";
import { StageList } from "@/features/templates/components/stage-list";

export default async function TemplateDetailPage({ params }: PageProps<"/templates/[id]">) {
  const { id } = await params;
  const template = await getTemplate(id);
  // RLS returns nothing for foreign orgs' templates — indistinguishable from
  // a nonexistent id, which is exactly the 404 we want.
  if (!template) notFound();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <TemplateHeader id={template.id} name={template.name} description={template.description} />
      <StageList templateId={template.id} stages={template.stages} />
    </div>
  );
}
