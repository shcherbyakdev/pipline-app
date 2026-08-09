import { listTemplates } from "@/features/templates/queries";
import { TemplateList } from "@/features/templates/components/template-list";
import { CreateTemplateDialog } from "@/features/templates/components/create-template-dialog";

export default async function TemplatesPage() {
  // `?new=1` is read client-side by CreateTemplateDialog (useSearchParams),
  // not here — see that component for why the dialog's open state can't be
  // seeded once from a server-rendered prop.
  const templates = await listTemplates();

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Templates</h1>
        <CreateTemplateDialog />
      </div>
      <TemplateList templates={templates} />
    </div>
  );
}
