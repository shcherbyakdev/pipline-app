import "server-only";
import type { EmailTransport } from "./transport";

// A send that hangs holds the caller's whole drain tick (and its claim on
// the row) hostage; Resend answers in well under a second when healthy, so
// anything past this is an outage, not a slow day.
const RESEND_TIMEOUT_MS = 10_000;

// Bare fetch on purpose — the Resend surface we use is one POST, and the
// Idempotency-Key header (24h dedupe window) is the second half of the
// drain's double-send defence. No SDK, no dependency.
export function resendTransport(apiKey: string, from: string): EmailTransport {
  return {
    async send(msg) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": msg.idempotencyKey,
        },
        body: JSON.stringify({
          from,
          to: [msg.to],
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          // Omitted rather than null: Resend validates the field when present.
          ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
        }),
        signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
      });
      if (!res.ok) {
        // Body is Resend's error JSON — safe to log (no token in emails' URLs
        // ever reaches here; only the failure envelope does).
        const body = await res.text().catch(() => "");
        throw new Error(`resend ${res.status}: ${body.slice(0, 300)}`);
      }
      const data = (await res.json()) as { id: string };
      return { id: data.id };
    },
  };
}
