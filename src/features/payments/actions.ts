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
import { isRpcSentinel } from "@/lib/rpc-sentinel";
import { generateAccessToken } from "@/lib/tokens";
import { buildBookingManageUrl } from "@/lib/tokens/booking";
import { clientMailCopy } from "@/lib/booking/client-locale";
import { getBookingMoney } from "@/lib/booking/public";
import { emailBadgeUrl } from "@/lib/billing/queries";
import { selectTransport } from "@/lib/email/transport";
import { formatMoney } from "@/lib/money";
import { moneyInfoLines } from "@/features/rentals/pricing";
import type { Line } from "@/features/rentals/pricing-rules";
import { balanceDueEmail, bookingLifecycleKey } from "@/features/scheduling/templates";
import { HOLD_OPTIONS, LEGAL_COUNTRIES, legalSchema } from "./legal";
import { getBookingSettlement, hasActivePaymentAccount } from "./queries";
import { chargeInput, hourlyRateCents, type Charge } from "./settlement";

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

/* ---------------------------------------------------------------- S7 ----
   After-session charges: what the studio adds once the session is over, and
   the four ways a balance stops being owed (paid by hand, paid online,
   written off, nothing due). Money is never recomputed here — the balance
   comes from booking_balance_cents (0082), whose TS twin is settlement.ts. */

/** The charges block's one read. The booking is proven to belong to the org
    with the RLS client FIRST; only then does the service-role balance helper
    (granted to service_role alone — a stranger's uuid must not be readable)
    get the id. */
export async function loadBookingSettlement(
  input: unknown,
): Promise<
  | {
      ok: true;
      charges: Charge[];
      writtenOffCents: number;
      writtenOffNote: string | null;
      balanceCents: number;
      hourlyRateCents: number | null;
      canCollect: boolean;
    }
  | { ok: false; error: string }
> {
  const t = await getTranslations("errors");
  const parsed = z.object({ bookingId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: t("generic") };
  try {
    const { org } = await requireOrg();
    const supabase = await createClient();
    const { data: b, error } = await supabase
      .from("bookings")
      .select("id, price_cents, lines, starts_at, ends_at, client_email")
      .eq("id", parsed.data.bookingId)
      .eq("org_id", org.id)
      .maybeSingle();
    if (error) { console.error("[payments] loadBookingSettlement:", error); return { ok: false, error: t("generic") }; }
    if (!b) return { ok: false, error: t("generic") };
    const [settlement, { data: due }, active] = await Promise.all([
      getBookingSettlement(b.id),
      createAdminClient().rpc("booking_balance_cents", { p_booking_id: b.id }),
      hasActivePaymentAccount(org.id),
    ]);
    return {
      ok: true,
      ...settlement,
      balanceCents: typeof due === "number" ? due : 0,
      hourlyRateCents: hourlyRateCents({
        lines: (b.lines as Line[] | null) ?? null,
        priceCents: b.price_cents,
        startsAt: new Date(b.starts_at),
        endsAt: new Date(b.ends_at),
      }),
      // Online collection needs both halves: somewhere to send the link and
      // an account that can take the money.
      canCollect: active && Boolean(b.client_email),
    };
  } catch (e) {
    console.error("[payments] loadBookingSettlement:", e);
    return { ok: false, error: t("generic") };
  }
}

/** S6: the OTHER units a booking holds (booking_units, 0084) — the rooms a
    whole-studio booking swallows, the lamps an add-on reserves. The detail
    dialog asks for every rental status, not just a settled one: the point of
    the line is to say what a PENDING request would block. The RLS client is
    the whole gate — booking_units is readable by the org's members only, so
    a stranger's uuid comes back empty. Sorted, since PostgREST's order is
    arbitrary and the line must not reshuffle between two opens. */
export async function loadBookingAlsoReserved(input: unknown): Promise<string[]> {
  const parsed = z.object({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return [];
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("booking_units")
      .select("rental_units(name)")
      .eq("booking_id", parsed.data.id)
      .eq("reserving", true)
      .neq("kind", "primary");
    if (error) { console.error("[payments] loadBookingAlsoReserved:", error); return []; }
    return (data as unknown as Array<{ rental_units: { name: string } | null }>)
      .map((r) => r.rental_units?.name)
      .filter((n): n is string => !!n)
      .sort();
  } catch (e) {
    console.error("[payments] loadBookingAlsoReserved:", e);
    return [];
  }
}

/** One line added to the bill. The RLS client writes it, so the org gate and
    the "the booking is ours" check are the table's policies (0082), not this
    code; `cents` is the CHECK's own arithmetic, restated here. */
export async function addBookingCharge(input: unknown): Promise<ActionResult> {
  const t = await getTranslations("errors");
  const parsed = chargeInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("generic") };
  try {
    const { org } = await requireOrg();
    const supabase = await createClient();
    const c = parsed.data;
    const { error } = await supabase.from("booking_charges").insert({
      org_id: org.id,
      booking_id: c.bookingId,
      kind: c.kind,
      label: c.label,
      qty: c.qty,
      unit_cents: c.unitCents,
      cents: c.qty * c.unitCents,
      note: c.note ?? null,
    });
    if (error) { console.error("[payments] addBookingCharge:", error); return { ok: false, error: t("generic") }; }
    revalidatePath("/bookings");
    revalidatePath("/overview");
    return { ok: true };
  } catch (e) {
    console.error("[payments] addBookingCharge:", e);
    return { ok: false, error: t("generic") };
  }
}

/** A charge is never edited, only taken off again. */
export async function deleteBookingCharge(input: unknown): Promise<ActionResult> {
  const t = await getTranslations("errors");
  const parsed = z.object({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: t("generic") };
  try {
    const { org } = await requireOrg();
    const supabase = await createClient();
    const { error } = await supabase.from("booking_charges").delete().eq("id", parsed.data.id).eq("org_id", org.id);
    if (error) { console.error("[payments] deleteBookingCharge:", error); return { ok: false, error: t("generic") }; }
    revalidatePath("/bookings");
    revalidatePath("/overview");
    return { ok: true };
  } catch (e) {
    console.error("[payments] deleteBookingCharge:", e);
    return { ok: false, error: t("generic") };
  }
}

/** "Forget it" — the balance becomes 0 and the note says why. The RPC owns
    the amount (whatever is due at that moment), so nothing is passed in. */
export async function writeOffBooking(input: unknown): Promise<ActionResult> {
  const t = await getTranslations("errors");
  const parsed = z.object({ id: z.uuid(), note: z.string().trim().max(500).optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: t("generic") };
  try {
    // The RPC gates on user_orgs() itself; requireOrg is the same front door
    // the sibling actions use, so a signed-out caller lands on /login.
    await requireOrg();
    const supabase = await createClient();
    const { error } = await supabase.rpc("write_off_booking", {
      p_booking_id: parsed.data.id,
      p_note: parsed.data.note ?? null,
    });
    if (error) {
      if (isRpcSentinel(error, "nothing_due")) return { ok: false, error: t("nothingDue") };
      console.error("[payments] writeOffBooking:", error);
      return { ok: false, error: t("generic") };
    }
    revalidatePath("/bookings");
    revalidatePath("/overview");
    return { ok: true };
  } catch (e) {
    console.error("[payments] writeOffBooking:", e);
    return { ok: false, error: t("generic") };
  }
}

/** "Here is what's left to pay" — the client's own pay link for the balance,
    mailed after the session. Mirrors resendManageLink: rotate the token
    first (the old link dies the moment that succeeds), then send. */
export async function sendBalanceLink(input: unknown): Promise<ActionResult> {
  const t = await getTranslations("errors");
  const parsed = z.object({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: t("generic") };
  try {
    const { org } = await requireOrg();
    const supabase = await createClient();
    const [{ data: booking, error: readError }, { data: orgRow }] = await Promise.all([
      supabase
        .from("bookings")
        .select("id, client_email, currency, starts_at, ends_at, rental_unit_id, locale, services(name), rental_offerings(name), rental_units(name)")
        .eq("id", parsed.data.id)
        .eq("org_id", org.id)
        .eq("status", "confirmed")
        .maybeSingle(),
      supabase.from("orgs").select("timezone, locale").eq("id", org.id).single(),
    ]);
    if (readError) { console.error("[payments] sendBalanceLink:", readError); return { ok: false, error: t("generic") }; }
    if (!booking || !orgRow) return { ok: false, error: t("generic") };
    if (!booking.client_email) return { ok: false, error: t("bookings.noEmail") };
    // Refuse before anything is written: nothing to collect, or nowhere for
    // the money to land.
    const { data: due } = await createAdminClient().rpc("booking_balance_cents", { p_booking_id: booking.id });
    const balance = typeof due === "number" ? due : 0;
    if (balance <= 0) return { ok: false, error: t("nothingDue") };
    if (!(await hasActivePaymentAccount(org.id))) return { ok: false, error: t("noPaymentAccount") };

    const fresh = generateAccessToken();
    const { error: rotateError } = await supabase.rpc("rotate_booking_token", {
      p_booking_id: booking.id,
      p_token_hash: fresh.tokenHash,
    });
    if (rotateError) { console.error("[payments] sendBalanceLink rotate:", rotateError); return { ok: false, error: t("generic") }; }

    const row = booking as unknown as {
      starts_at: string; ends_at: string; rental_unit_id: string | null; locale: string | null;
      services: { name: string } | null; rental_offerings: { name: string } | null; rental_units: { name: string } | null;
    };
    const forClient = await clientMailCopy(row, { locale: orgRow.locale, timezone: orgRow.timezone });
    const [money, settlement, badgeUrl] = await Promise.all([
      getBookingMoney(booking.id),
      getBookingSettlement(booking.id),
      emailBadgeUrl(org.id),
    ]);
    const msg = balanceDueEmail(forClient.t, {
      orgName: org.name,
      serviceName: forClient.serviceName,
      whenLine: forClient.whenLine,
      amount: formatMoney(balance, booking.currency ?? "PLN"),
      // No ?lang: the pay route resolves the booking's own stamped locale
      // (getBookingLocale) when none is given, which is exactly the language
      // clientMailCopy just wrote this mail in.
      payUrl: `${env.NEXT_PUBLIC_APP_URL}/booking/${fresh.token}/pay`,
      manageUrl: buildBookingManageUrl(fresh.token),
      badgeUrl,
      infoLines: moneyInfoLines(
        { ...money, charges: settlement.charges, writtenOffCents: settlement.writtenOffCents, onlinePay: true },
        forClient.tUnits,
      ),
    });
    await selectTransport().send({
      to: booking.client_email,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      // Keyed per rotation (hash prefix), like resendManageLink: the send
      // above already killed the previous mail's pay link, so a second ask at
      // the same balance must not be deduped into nothing.
      idempotencyKey: bookingLifecycleKey(booking.id, `balance-due-${fresh.tokenHash.slice(0, 8)}`),
    });
    return { ok: true };
  } catch (e) {
    console.error("[payments] sendBalanceLink:", e);
    return { ok: false, error: t("generic") };
  }
}
