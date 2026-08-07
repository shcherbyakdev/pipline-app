/**
 * Proves the magic-link auth flow end-to-end through the local Mailpit
 * mail catcher — the same mechanism the /auth/confirm route relies on.
 * Run: npx tsx scripts/verify-auth.ts
 * Requires: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
 *           in the environment (.env.local), plus local Supabase + Mailpit
 *           running (Mailpit at http://127.0.0.1:54354).
 */
import { loadEnvFile } from "node:process";
try {
  loadEnvFile(".env.local");
} catch {
  // Env may already be exported into the shell (e.g. `source .env.local`).
}

import { createClient } from "@supabase/supabase-js";
import type { EmailOtpType } from "@supabase/supabase-js";

const MAILPIT_URL = "http://127.0.0.1:54354";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!url || !anonKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY in environment.",
  );
  process.exit(1);
}

const anon = createClient(url, anonKey, { auth: { persistSession: false } });

type MailpitMessageSummary = { ID: string };
type MailpitListResponse = { messages: MailpitMessageSummary[] };
type MailpitMessage = { HTML?: string; Text?: string };

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findMagicLinkEmail(toEmail: string): Promise<MailpitMessage> {
  const maxAttempts = 10;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const listRes = await fetch(`${MAILPIT_URL}/api/v1/messages`);
    if (!listRes.ok) {
      throw new Error(`Mailpit list request failed: ${listRes.status}`);
    }
    const list = (await listRes.json()) as MailpitListResponse;

    for (const summary of list.messages ?? []) {
      const msgRes = await fetch(`${MAILPIT_URL}/api/v1/message/${summary.ID}`);
      if (!msgRes.ok) continue;
      const msg = (await msgRes.json()) as MailpitMessage;
      const body = msg.HTML ?? msg.Text ?? "";
      if (body.includes("/auth/confirm") && body.includes("token_hash=")) {
        return msg;
      }
    }

    await sleep(1000);
  }
  throw new Error(
    `Timed out waiting for magic-link email to ${toEmail} in Mailpit.`,
  );
}

function extractTokenHashAndType(
  body: string,
): { token_hash: string; type: EmailOtpType } {
  const match = body.match(
    /\/auth\/confirm\?[^"'\s]*token_hash=([^&"'\s]+)[^"'\s]*&type=([^&"'\s]+)|\/auth\/confirm\?[^"'\s]*type=([^&"'\s]+)[^"'\s]*&token_hash=([^&"'\s]+)/,
  );
  if (!match) {
    throw new Error("Could not find token_hash/type in email body.");
  }
  const token_hash = decodeURIComponent(match[1] ?? match[4] ?? "");
  const type = decodeURIComponent(match[2] ?? match[3] ?? "") as EmailOtpType;
  if (!token_hash || !type) {
    throw new Error("Parsed empty token_hash or type from email body.");
  }
  return { token_hash, type };
}

async function main() {
  // Clear any existing mail so we unambiguously pick up the new message.
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: "DELETE" });

  const email = `t_${Date.now()}@example.com`;
  console.log(`Requesting magic link for ${email}...`);

  const { error: otpError } = await anon.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: "http://localhost:3000/auth/confirm" },
  });
  if (otpError) {
    console.error("signInWithOtp failed:", otpError.message);
    process.exit(1);
  }

  console.log("Polling Mailpit for the magic-link email...");
  const message = await findMagicLinkEmail(email);
  const body = message.HTML ?? message.Text ?? "";
  const { token_hash, type } = extractTokenHashAndType(body);
  console.log(`Extracted token_hash (len ${token_hash.length}) and type "${type}".`);

  const { data, error: verifyError } = await anon.auth.verifyOtp({
    token_hash,
    type,
  });

  if (verifyError) {
    console.error("verifyOtp failed:", verifyError.message);
    process.exit(1);
  }
  if (!data.session) {
    console.error("verifyOtp succeeded but returned no session.");
    process.exit(1);
  }

  console.log(`Session established for user ${data.session.user.email}.`);
  console.log("AUTH FLOW OK");
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
