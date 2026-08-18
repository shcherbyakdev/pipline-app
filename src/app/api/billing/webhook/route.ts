import { revalidatePath } from "next/cache";
import { env } from "@/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectBillingProvider } from "@/lib/billing/provider";
import { applyBillingEvents } from "@/lib/billing/apply-events";

// Provider → cache. Raw body first (signatures cover bytes). Fail closed
// when the provider secret is unset (drain-auth idiom). Business-level
// unknowns (org missing) return 200 — never make the provider retry a bug.
export async function POST(request: Request) {
  const secretSet = env.BILLING_PROVIDER === "stripe" ? Boolean(env.STRIPE_WEBHOOK_SECRET) : Boolean(env.BILLING_FAKE_SECRET);
  if (!secretSet) return Response.json({ error: "billing webhook disabled" }, { status: 503 });
  const rawBody = await request.text();
  let events;
  try {
    events = selectBillingProvider().parseWebhook(rawBody, request.headers);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/signature/i.test(msg)) return Response.json({ error: "unauthorized" }, { status: 401 });
    return Response.json({ error: "malformed" }, { status: 400 });
  }
  try {
    const summary = await applyBillingEvents(createAdminClient(), events);
    if (summary.processed > 0) {
      try { revalidatePath("/billing"); } catch { /* not in a request context (tests) */ }
    }
    return Response.json(summary);
  } catch (error) {
    console.error("[billing] webhook apply failed:", error);
    return Response.json({ error: "apply failed" }, { status: 500 });
  }
}
