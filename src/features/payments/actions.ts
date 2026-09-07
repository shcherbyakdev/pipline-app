"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { env } from "@/env";
import { requireOrg } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { paymentsConfigured, selectPaymentsProvider } from "@/lib/payments/provider";
import { HOLD_OPTIONS, LEGAL_COUNTRIES, legalSchema } from "./legal";

export type ActionResult = { ok: true } | { ok: false; error: string };

const back = (q: string) => `${env.NEXT_PUBLIC_APP_URL}/payments?${q}`;

/** Connect Stripe: create the connected account once, then hosted onboarding. */
export async function connectStripe(formData: FormData): Promise<never> {
  if (!paymentsConfigured()) redirect("/payments?stripe=error");
  const { user, org } = await requireOrg();
  const country = z.enum(LEGAL_COUNTRIES).catch("PL").parse(String(formData.get("country") ?? "PL"));
  const admin = createAdminClient();
  const provider = selectPaymentsProvider();
  let url: string;
  try {
    const { data: existing } = await admin.from("payment_accounts").select("stripe_account_id").eq("org_id", org.id).maybeSingle();
    let accountId = existing?.stripe_account_id as string | undefined;
    if (!accountId) {
      accountId = (await provider.createAccount({ country, email: user.email ?? "", displayName: org.name })).accountId;
      const { error } = await admin.from("payment_accounts").insert({ org_id: org.id, stripe_account_id: accountId });
      if (error) throw error;
    }
    url = await provider.createOnboardingLink(accountId, back("stripe=return"), back("stripe=refresh"));
  } catch (e) {
    console.error("[payments] connectStripe:", e);
    redirect("/payments?stripe=error");
  }
  redirect(url);
}

/** A fresh onboarding link for an account that exists (return/refresh/restricted). */
export async function continueOnboarding(): Promise<never> {
  return connectStripe(new FormData());
}

const settingsInput = z.object({
  holdMin: z.coerce.number().refine((n): n is (typeof HOLD_OPTIONS)[number] => (HOLD_OPTIONS as readonly number[]).includes(n)),
  legal: legalSchema,
});

export async function updatePaymentSettings(input: unknown): Promise<ActionResult> {
  const t = await getTranslations("errors");
  const parsed = settingsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("generic") };
  try {
    const { org } = await requireOrg();
    const supabase = await createClient();
    const { error } = await supabase.rpc("update_org_payments", { p_org_id: org.id, p_hold_min: parsed.data.holdMin, p_legal: parsed.data.legal });
    if (error) { console.error("[payments] updatePaymentSettings:", error); return { ok: false, error: t("generic") }; }
    revalidatePath("/payments");
    return { ok: true };
  } catch (e) {
    console.error("[payments] updatePaymentSettings:", e);
    return { ok: false, error: t("generic") };
  }
}
