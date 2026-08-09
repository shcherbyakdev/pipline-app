"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createOrgSchema, type OrgState } from "./schema";

export async function createOrg(
  _prev: OrgState,
  formData: FormData,
): Promise<OrgState> {
  const parsed = createOrgSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: "Organization name must be 2–80 characters." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.rpc("create_org", { p_name: parsed.data.name });
  if (error) return { error: error.message };

  redirect("/programs");
}
