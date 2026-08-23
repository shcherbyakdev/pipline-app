import "server-only";
import { env } from "@/env";
import { resendTransport } from "./resend";
import { smtpTransport } from "./smtp";

export type OutboundEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  // Stable per logical send (chase/{id}/send/{n}) — the dedupe handle.
  idempotencyKey: string;
  // Where a reply lands. Mail goes out from the platform's own address, so
  // without this a client hitting "reply" on a confirmation writes to a
  // noreply mailbox instead of the provider who can actually answer.
  replyTo?: string;
};

export type EmailTransport = {
  send(msg: OutboundEmail): Promise<{ id: string }>;
};

// The ONLY vendor decision in the codebase. Resend when keyed (production),
// SMTP when configured (local Mailpit), otherwise fail loudly — a chase
// engine that silently "sends" nothing is worse than one that crashes.
export function selectTransport(): EmailTransport {
  if (env.RESEND_API_KEY) {
    if (!env.EMAIL_FROM) throw new Error("RESEND_API_KEY set but EMAIL_FROM missing");
    return resendTransport(env.RESEND_API_KEY, env.EMAIL_FROM);
  }
  if (env.SMTP_HOST && env.SMTP_PORT) {
    return smtpTransport(env.SMTP_HOST, env.SMTP_PORT, env.EMAIL_FROM ?? "Booklo <chase@localhost>");
  }
  throw new Error("No email transport configured (RESEND_API_KEY or SMTP_HOST+SMTP_PORT)");
}
