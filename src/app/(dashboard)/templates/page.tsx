import { listTemplates } from "@/features/templates/queries";
import { TemplateList } from "@/features/templates/components/template-list";
import { CreateTemplateDialog } from "@/features/templates/components/create-template-dialog";

export default async function TemplatesPage({ searchParams }: PageProps<"/templates">) {
  const [templates, params] = await Promise.all([listTemplates(), searchParams]);
  const openCreate = params.new === "1";

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Templates</h1>
        <CreateTemplateDialog defaultOpen={openCreate} />
      </div>
      <TemplateList templates={templates} />
    </div>
  );
}
