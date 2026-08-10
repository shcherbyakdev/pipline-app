/**
 * Idempotent demo data for local development.
 * Run: npm run db:seed  (or npm run db:reset for a clean slate)
 *
 * Goes through the create_org RPC rather than inserting directly, so the org
 * and the caller's owner membership are created the same way onboarding does.
 */
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { hostnameOf, isLoopbackHost } from "./lib/host-guard";

try {
  loadEnvFile(".env.local");
} catch {
  // Already-exported env (CI) is fine.
}

const DEMO_EMAIL = "demo@rolloutos.local";
const DEMO_PASSWORD = "Password123!";
const DEMO_ORG = "Demo Programs";
const DEMO_TEMPLATE = "Store Refresh";
const DEMO_STAGES = ["Survey", "Install", "QA", "Sign-off"];
const DEMO_REQUIREMENTS: Record<
  string,
  Array<{ type: string; label: string; required: boolean; config?: Record<string, unknown> }>
> = {
  Survey: [
    { type: "date", label: "Survey date", required: true },
    { type: "choice", label: "Access route", required: true, config: { options: ["Front", "Rear"] } },
  ],
  Install: [
    { type: "number", label: "Fixtures installed", required: true },
    { type: "checklist", label: "Install checks", required: true, config: { items: ["Power connected", "Area cleaned"] } },
  ],
};
const DEMO_PROGRAM = "Q3 Store Refresh";
const DEMO_UNITS: Array<{ name: string; ref: string }> = [
  { name: "Store #101 — Kraków", ref: "S-101" },
  { name: "Store #102 — Gdańsk", ref: "S-102" },
];
// Store #101's Survey stage is demonstrated via the requirements path below
// (ensureDemoProgress inserts responses that satisfy it); DEMO_PROGRESS only
// lists the stages still shown via the bare status override chip.
const DEMO_PROGRESS: Array<{ unit: string; stages: string[] }> = [
  { unit: "Store #101 — Kraków", stages: ["Install"] },
  { unit: "Store #102 — Gdańsk", stages: ["Survey"] },
];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error("seed: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and");
  console.error("      SUPABASE_SERVICE_ROLE_KEY must be set. Run `npm run setup` first.");
  process.exit(1);
}

// Refuse to run against anything but a local Supabase instance. This script
// creates a fixed, publicly-documented, admin-capable login
// (demo@rolloutos.local / Password123!) — safe on a throwaway local DB,
// a liability against a real project. `hostnameOf` parses with `new URL`
// and compares the resolved `hostname`, not a substring match, so a URL
// crafted like "https://evil.com/?x=127.0.0.1" cannot slip through.
function assertLocalSupabaseUrl(rawUrl: string): void {
  const hostname = hostnameOf(rawUrl);
  if (hostname === null) {
    console.error(`seed: NEXT_PUBLIC_SUPABASE_URL is not a valid URL: "${rawUrl}"`);
    process.exit(1);
  }

  if (isLoopbackHost(hostname)) return;

  if (process.env.ALLOW_REMOTE_SEED === "1") {
    console.warn(`seed: WARNING — seeding a NON-LOCAL Supabase project at host "${hostname}".`);
    console.warn(`seed: this creates the known-password account ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
    console.warn("seed: on that project. Proceeding because ALLOW_REMOTE_SEED=1.");
    return;
  }

  console.error(`seed: refusing to seed non-local host "${hostname}".`);
  console.error(`seed: this script creates a publicly-documented account`);
  console.error(`seed: (${DEMO_EMAIL} / ${DEMO_PASSWORD}) — safe for a local Supabase, a`);
  console.error("seed: liability against a remote or staging project.");
  console.error("seed: only loopback hosts (127.0.0.1, localhost, [::1]) are allowed.");
  console.error("seed: to seed a remote project on purpose, set ALLOW_REMOTE_SEED=1.");
  process.exit(1);
}

assertLocalSupabaseUrl(url);

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function ensureDemoUser(): Promise<void> {
  const { error } = await admin.auth.admin.createUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    email_confirm: true,
  });
  if (!error) return;
  // Re-running the seed is expected; an existing user is not a failure.
  // Prefer the stable typed error code from @supabase/auth-js; fall back to
  // matching the message text for older/edge responses that omit it.
  const isExistingUser =
    error.code === "email_exists" || /already been registered|already exists/i.test(error.message);
  if (!isExistingUser) throw error;
}

async function ensureDemoTemplate(
  client: SupabaseClient,
  orgId: string,
): Promise<void> {
  const { data: found, error: findError } = await client
    .from("templates")
    .select("id")
    .eq("org_id", orgId)
    .eq("name", DEMO_TEMPLATE)
    .maybeSingle();
  if (findError) throw findError;
  if (found) {
    console.log(`seed: template "${DEMO_TEMPLATE}" already exists — nothing to do`);
    return;
  }

  const { data: template, error: templateError } = await client
    .from("templates")
    .insert({ org_id: orgId, name: DEMO_TEMPLATE, description: "Demo workflow" })
    .select("id")
    .single();
  if (templateError) throw templateError;

  const stagesData = DEMO_STAGES.map((name, position) => ({
    template_id: template.id,
    org_id: orgId,
    name,
    position,
  }));
  const { error: stagesError } = await client.from("template_stages").insert(stagesData);
  if (stagesError) throw stagesError;
  console.log(`seed: created template "${DEMO_TEMPLATE}" with ${DEMO_STAGES.length} stages`);

  const { data: createdStages, error: stagesReadError } = await client
    .from("template_stages")
    .select("id, name")
    .eq("template_id", template.id);
  if (stagesReadError) throw stagesReadError;
  const requirementRows = (createdStages ?? []).flatMap((stage) =>
    (DEMO_REQUIREMENTS[stage.name] ?? []).map((r, position) => ({
      template_stage_id: stage.id,
      org_id: orgId,
      type: r.type,
      label: r.label,
      required: r.required,
      config: r.config ?? {},
      position,
    })),
  );
  if (requirementRows.length > 0) {
    const { error: reqError } = await client
      .from("template_stage_requirements")
      .insert(requirementRows);
    if (reqError) throw reqError;
    console.log(`seed: added ${requirementRows.length} requirements to "${DEMO_TEMPLATE}"`);
  }
}

async function ensureDemoProgram(client: SupabaseClient, orgId: string): Promise<void> {
  const { data: found, error: findError } = await client
    .from("programs")
    .select("id")
    .eq("org_id", orgId)
    .eq("name", DEMO_PROGRAM)
    .maybeSingle();
  if (findError) throw findError;
  if (found) {
    console.log(`seed: program "${DEMO_PROGRAM}" already exists — nothing to do`);
    return;
  }

  // Runs outside ensureDemoTemplate's early-return: look the template up
  // regardless of whether it was just created.
  const { data: template, error: templateError } = await client
    .from("templates")
    .select("id")
    .eq("org_id", orgId)
    .eq("name", DEMO_TEMPLATE)
    .maybeSingle();
  if (templateError) throw templateError;
  if (!template) throw new Error(`seed: template "${DEMO_TEMPLATE}" not found`);

  const { data: program, error: rpcError } = await client.rpc("create_program", {
    p_template_id: template.id,
    p_name: DEMO_PROGRAM,
  });
  if (rpcError) throw rpcError;

  const { error: unitsError } = await client.from("units").insert(
    DEMO_UNITS.map((u) => ({
      program_id: (program as { id: string }).id,
      org_id: orgId,
      name: u.name,
      external_ref: u.ref,
    })),
  );
  if (unitsError) throw unitsError;
  console.log(`seed: created program "${DEMO_PROGRAM}" with ${DEMO_UNITS.length} units`);
}

async function ensureDemoProgress(client: SupabaseClient, orgId: string): Promise<void> {
  const { data: program, error: programError } = await client
    .from("programs")
    .select("id")
    .eq("org_id", orgId)
    .eq("name", DEMO_PROGRAM)
    .maybeSingle();
  if (programError) throw programError;
  if (!program) throw new Error(`seed: program "${DEMO_PROGRAM}" not found`);

  const { data: stages, error: stagesError } = await client
    .from("program_stages")
    .select("id, name")
    .eq("program_id", program.id);
  if (stagesError) throw stagesError;
  const { data: units, error: unitsError } = await client
    .from("units")
    .select("id, name")
    .eq("program_id", program.id);
  if (unitsError) throw unitsError;

  // Store #101's Survey stage demos the requirements path: answer its
  // requirements so the derive trigger marks the stage done
  // (done_source='requirements'), instead of the bare status override used
  // for the other demo stages below.
  const store101 = (units ?? []).find((u) => u.name === "Store #101 — Kraków");
  const surveyStage = (stages ?? []).find((s) => s.name === "Survey");
  if (store101 && surveyStage) {
    const { data: surveyUnitStage, error: surveyUnitStageError } = await client
      .from("unit_stages")
      .select("id")
      .eq("unit_id", store101.id)
      .eq("program_stage_id", surveyStage.id)
      .maybeSingle();
    if (surveyUnitStageError) throw surveyUnitStageError;
    const { data: surveyReqs, error: surveyReqsError } = await client
      .from("program_stage_requirements")
      .select("id, label")
      .eq("program_stage_id", surveyStage.id);
    if (surveyReqsError) throw surveyReqsError;
    const surveyDateReq = (surveyReqs ?? []).find((r) => r.label === "Survey date");
    const accessRouteReq = (surveyReqs ?? []).find((r) => r.label === "Access route");
    if (surveyUnitStage && surveyDateReq && accessRouteReq) {
      // Idempotent: upsert on the (unit_stage, requirement) conflict target
      // converges on re-run, same as the status updates below.
      const { error: responseError } = await client.from("unit_stage_responses").upsert(
        [
          {
            unit_stage_id: surveyUnitStage.id,
            program_stage_requirement_id: surveyDateReq.id,
            value_date: "2026-08-01",
          },
          {
            unit_stage_id: surveyUnitStage.id,
            program_stage_requirement_id: accessRouteReq.id,
            value_text: "Front",
          },
        ],
        { onConflict: "unit_stage_id,program_stage_requirement_id" },
      );
      if (responseError) throw responseError;
      console.log("seed: answered Survey requirements for Store #101");
    }
  }

  // Idempotent: plain status updates converge on re-run; done_at is
  // trigger-maintained (done → done leaves it untouched).
  for (const target of DEMO_PROGRESS) {
    const unit = (units ?? []).find((u) => u.name === target.unit);
    if (!unit) continue;
    const stageIds = (stages ?? [])
      .filter((s) => target.stages.includes(s.name))
      .map((s) => s.id);
    if (stageIds.length === 0) continue;
    const { error } = await client
      .from("unit_stages")
      .update({ status: "done" })
      .eq("unit_id", unit.id)
      .in("program_stage_id", stageIds);
    if (error) throw error;
  }
  console.log("seed: demo progress applied");
}

async function main(): Promise<void> {
  await ensureDemoUser();

  const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  });
  if (signInError) throw signInError;

  // RLS scopes this select to the demo user's own orgs.
  const { data: existing, error: selectError } = await client.from("orgs").select("id, name");
  if (selectError) throw selectError;

  let orgId: string;
  if (existing && existing.length > 0) {
    console.log(`seed: ${DEMO_EMAIL} already owns "${existing[0].name}"`);
    orgId = existing[0].id;
  } else {
    const { data: created, error: rpcError } = await client.rpc("create_org", {
      p_name: DEMO_ORG,
    });
    if (rpcError) throw rpcError;
    orgId = (created as { id: string }).id;
    console.log(`seed: created "${DEMO_ORG}"`);
  }

  await ensureDemoTemplate(client, orgId);
  await ensureDemoProgram(client, orgId);
  await ensureDemoProgress(client, orgId);
  console.log(`seed: sign in as ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main().catch((error: unknown) => {
  console.error("seed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
