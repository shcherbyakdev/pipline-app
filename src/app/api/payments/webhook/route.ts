import { createAdminClient } from "@/lib/supabase/admin";
import { paymentsConfigured, selectPaymentsProvider } from "@/lib/payments/provider";
import { applyPaymentEvents } from "@/features/payments/apply";

// Connect webhook: events from the studios' accounts. Raw body first
// (signatures cover bytes); fail closed when unconfigured; 401 signature;
// 400 malformed; business unknowns are 200 (never make Stripe retry a bug);
// our own failure is 500 (Stripe retries).
export async function POST(request: Request) {
  if (!paymentsConfigured()) return Response.json({ error: "payments webhook disabled" }, { status: 503 });
  let provider;
  try {
    provider = selectPaymentsProvider();
  } catch (error) {
    console.error("[payments] provider construction failed:", error);
    return Response.json({ error: "payments webhook disabled" }, { status: 503 });
  }
  const rawBody = await request.text();
  let events;
  try {
    events = provider.parseWebhook(rawBody, request.headers);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/signature/i.test(msg)) return Response.json({ error: "unauthorized" }, { status: 401 });
    return Response.json({ error: "malformed" }, { status: 400 });
  }
  try {
    return Response.json(await applyPaymentEvents(events, { db: createAdminClient(), provider }));
  } catch (error) {
    console.error("[payments] webhook apply failed:", error);
    return Response.json({ error: "apply failed" }, { status: 500 });
  }
}
