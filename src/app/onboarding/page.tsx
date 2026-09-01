import Link from "next/link";
import { redirect } from "next/navigation";
import { env } from "@/env";
import { getCurrentOrg, requireUser, type Org } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/features/auth/actions";
import { HANDLE_RE, isReservedHandle, normalizeHandle } from "@/features/scheduling/handle";
import { hostLabel } from "@/lib/booking/url";
import { effectiveMode, modeOf } from "@/features/orgs/mode";
import {
  nextStepHref,
  parseWizardStep,
  stepHref,
  wizardSteps,
  type WizardStep,
} from "@/features/orgs/onboarding-steps";
import { getDashboardFlags } from "@/lib/flags/resolve";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { getBookingOrg } from "@/lib/booking/public";
import { listPublicCatalog, catalogueHas } from "@/lib/booking/catalog";
import { resolveChannelPage } from "@/lib/booking/channel-pages";
import { ONBOARDING } from "@/features/marketing/site";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { OnboardingForm } from "./onboarding-form";
import { WizardStepper } from "./wizard-stepper";
import { CopyLinkButton, HoursStepForm, ModeStepForm, ServiceStepForm, SpaceStepForm } from "./wizard-forms";

export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const user = await requireUser();
  const org = await getCurrentOrg();
  const { step: rawStep } = await searchParams;

  let content: React.ReactNode;
  let stepper: React.ReactNode;
  if (!org) {
    // Pre-org: one screen — create the workspace. No dots here: the
    // stepper begins with the wizard, where steps can be skipped.
    // Prefill: the landing claim when there is one; otherwise both fields
    // seed from the email's local part (plus-address suffix dropped) — an
    // editable suggestion beats a blank form. Anything that doesn't survive
    // handle validation leaves the fields empty as before.
    const raw = user.user_metadata?.claimed_handle;
    const claimed = typeof raw === "string" && HANDLE_RE.test(raw) && !isReservedHandle(raw) ? raw : null;
    const fromEmail = normalizeHandle(
      // Dots/underscores separate words in email local parts — keep them as
      // dashes so "anna.kowalska" seeds "Anna Kowalska", not "Annakowalska".
      (user.email ?? "").split("@")[0].split("+")[0].replace(/[._]+/g, "-"),
    ).replace(/-+$/, "");
    const seed = claimed ?? (HANDLE_RE.test(fromEmail) && !isReservedHandle(fromEmail) ? fromEmail : null);
    content = <OnboardingForm initialHandle={seed} host={hostLabel(env.NEXT_PUBLIC_APP_URL)} />;
    stepper = null;
  } else {
    // Post-org wizard: ?step= names the screen; anything unknown, missing,
    // or not in this org's flow keeps the old guard — /bookings.
    const steps = wizardSteps(effectiveMode(await getDashboardFlags(org.id), modeOf(org)));
    const step = parseWizardStep(rawStep, steps);
    if (!step) redirect("/bookings");
    content = <WizardStepContent step={step} steps={steps} org={org} />;
    stepper = (
      <WizardStepper
        count={steps.length}
        active={steps.indexOf(step)}
        hrefs={steps.map((s) => ({ href: stepHref(s), label: ONBOARDING.wizard[s].heading }))}
      />
    );
  }

  return (
    // The workspace-creation flow is the entrance to the admin, so it follows
    // the viewer's theme like every other admin surface (it used to force
    // `.dark`, which jarred: light landing → confirm link → dark wizard):
    // no panel, a narrow centred column on the ground, the signed-in
    // account pinned at the bottom. Lives outside the (auth) group because
    // this route already has a session.
    <main className="bg-background text-foreground flex min-h-full flex-1 flex-col items-center p-6">
      <div className="flex w-full max-w-[400px] flex-1 flex-col justify-center py-10">{content}</div>
      {stepper}
      {/* The account footer belongs to the create screen ("am I signing up
          with the right account?"); the wizard steps drop it. */}
      {!org ? (
        <div className="flex flex-col items-center gap-1 pb-2 text-sm">
          <p className="text-muted-foreground">Using {user.email}</p>
          <form action={signOut}>
            <button
              type="submit"
              className="text-muted-foreground/70 hover:text-foreground rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              Use a different account
            </button>
          </form>
        </div>
      ) : null}
    </main>
  );
}

async function WizardStepContent({ step, steps, org }: { step: WizardStep; steps: WizardStep[]; org: Org }) {
  const nextHref = nextStepHref(step, steps);
  const copy = ONBOARDING.wizard[step];
  // The org's public identity: orgs.handle is the page address (/<handle>);
  // orgs.slug is an internal slug that resolves nowhere public — never share
  // it. Currency rides along for the price placeholders.
  const settings = await getSchedulingSettings();
  const handle = settings?.handle ?? null;
  let live = false;
  let body: React.ReactNode;

  if (step === "mode") {
    const initialMode = org.offersRentals ? (org.offersAppointments ? "both" : "rentals") : "appointments";
    body = <ModeStepForm initialMode={initialMode} nextHref={nextHref} />;
  } else if (step === "service" || step === "space") {
    const currency = settings?.currency ?? "USD";
    body =
      step === "service" ? (
        <ServiceStepForm currency={currency} nextHref={nextHref} />
      ) : (
        <SpaceStepForm currency={currency} nextHref={nextHref} />
      );
  } else if (step === "hours") {
    // Whose hours: the org's first team member, the same row the seeding
    // targeted (orgs/actions.ts seedFirstMemberHours). No staff row is a
    // seed-time anomaly, not a wall — move along.
    const supabase = await createClient();
    const { data: staff } = await supabase.from("staff").select("id").eq("org_id", org.id).limit(1).maybeSingle();
    if (!staff) redirect(nextHref);
    const { data: rules } = await supabase
      .from("availability_rules")
      .select("weekday, start_time, end_time")
      .eq("staff_id", staff.id)
      .order("weekday")
      .order("start_time");
    // One window per day in the wizard; a day's first window stands for it.
    const seen = new Set<number>();
    const initialDays = (rules ?? [])
      .filter((r) => !seen.has(r.weekday) && (seen.add(r.weekday), true))
      .map((r) => ({ weekday: r.weekday, startTime: r.start_time.slice(0, 5), endTime: r.end_time.slice(0, 5) }));
    body = <HoursStepForm staffId={staff.id} initialDays={initialDays} nextHref={nextHref} />;
  } else {
    // "Live" means /<handle> actually resolves — same rule as BookPage
    // (app/[handle]/page.tsx): the gated catalogue must have something
    // public, or the route 404s (D9's intentional 404). Run the exact same
    // resolution here so a copied link is never a dead one.
    if (handle) {
      const bookingOrg = await getBookingOrg(handle);
      live = bookingOrg
        ? resolveChannelPage("root", catalogueHas(await listPublicCatalog(bookingOrg))) !== null
        : false;
    }
    body = <ShareStep handle={handle} live={live} />;
  }

  const share = ONBOARDING.wizard.share;
  const heading =
    step !== "share" ? copy.heading : !handle ? share.noHandle : live ? share.heading : share.almostHeading;
  const sub = step !== "share" ? copy.sub : !handle ? share.noHandleSub : live ? share.sub : share.almostSub;
  return (
    <div key={step} className="step-enter flex flex-col gap-6">
      <div className="mb-2 text-center">
        <h1 className="text-xl font-semibold tracking-tight">{heading}</h1>
        <p className="text-muted-foreground mt-1.5 text-sm text-pretty">{sub}</p>
      </div>
      {body}
    </div>
  );
}

function ShareStep({ handle, live }: { handle: string | null; live: boolean }) {
  const share = ONBOARDING.wizard.share;
  return (
    <div className="flex flex-col items-center gap-6">
      {handle ? (
        <p className="bg-card w-full rounded-xl border px-4 py-3 text-center font-mono text-sm">
          {hostLabel(env.NEXT_PUBLIC_APP_URL)}/{handle}
        </p>
      ) : null}
      {handle && live ? (
        // Live: the link works — copy it and go.
        <div className="flex items-center gap-2">
          <CopyLinkButton url={`${env.NEXT_PUBLIC_APP_URL}/${handle}`} />
          <Link href="/bookings" className={cn(buttonVariants(), "h-11 px-6")}>
            {share.finish}
          </Link>
        </div>
      ) : (
        // Not yet resolvable (no handle, or nothing publicly bookable):
        // don't hand out a link that 404s — the booking-page starter is
        // the way there.
        <div className="flex items-center gap-2">
          <Link href="/booking-page" className={cn(buttonVariants(), "h-11 px-6")}>
            {share.setUpPage}
          </Link>
          <Link href="/bookings" className={cn(buttonVariants({ variant: "outline" }), "h-11 px-6")}>
            {share.finish}
          </Link>
        </div>
      )}
    </div>
  );
}
