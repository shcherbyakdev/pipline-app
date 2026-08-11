import "server-only";
import { createConnection } from "node:net";
import type { EmailTransport } from "./transport";

// Minimal SMTP for LOCAL DEV ONLY: plaintext, no auth, localhost Mailpit.
// Production email is the Resend transport; this exists so the whole slice
// runs offline with zero dependencies. Not for real mail servers.
function smtpExchange(host: string, port: number, cmdsAfterGreeting: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    const queue = [...cmdsAfterGreeting];
    let buffer = "";
    const fail = (err: Error) => {
      socket.destroy();
      reject(err);
    };
    socket.setTimeout(10_000, () => fail(new Error("smtp timeout")));
    socket.on("error", fail);
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      // Responses end with "<code><space>...<CRLF>" on the final line.
      if (!/^\d{3} [^\r\n]*\r\n$/m.test(buffer)) return;
      const code = Number(buffer.slice(0, 3));
      buffer = "";
      if (code >= 400) return fail(new Error(`smtp ${code}`));
      const next = queue.shift();
      if (next === undefined) {
        socket.end();
        return resolve();
      }
      socket.write(next);
    });
  });
}

export function smtpTransport(host: string, port: number, from: string): EmailTransport {
  // "Name <addr>" → addr for the envelope.
  const envelopeFrom = from.match(/<([^>]+)>/)?.[1] ?? from;
  return {
    async send(msg) {
      const body =
        `From: ${from}\r\n` +
        `To: ${msg.to}\r\n` +
        `Subject: ${msg.subject}\r\n` +
        `MIME-Version: 1.0\r\n` +
        `Content-Type: text/html; charset=utf-8\r\n` +
        `\r\n` +
        // Dot-stuffing (RFC 5321 §4.5.2): a leading "." would end DATA early.
        msg.html.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..") +
        `\r\n.\r\n`;
      await smtpExchange(host, port, [
        `EHLO localhost\r\n`,
        `MAIL FROM:<${envelopeFrom}>\r\n`,
        `RCPT TO:<${msg.to}>\r\n`,
        `DATA\r\n`,
        body,
        `QUIT\r\n`,
      ]);
      return { id: msg.idempotencyKey };
    },
  };
}
