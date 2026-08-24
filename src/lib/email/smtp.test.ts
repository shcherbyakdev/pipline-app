import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type AddressInfo, type Server } from "node:net";
import { headerValue, smtpTransport } from "./smtp";

// A stub SMTP server on a random loopback port: greets, says 250 to every
// command, captures the DATA block verbatim. Enough to prove what actually
// goes over the wire, which is the whole point of the header tests below —
// a regex on a string builder proves nothing about the envelope commands.
type Exchange = { commands: string[]; data: string };

let server: Server;
let port: number;
const exchanges: Exchange[] = [];

beforeAll(async () => {
  server = createServer((socket) => {
    const exchange: Exchange = { commands: [], data: "" };
    exchanges.push(exchange);
    let inData = false;
    let buffer = "";
    socket.write("220 stub ready\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (inData) {
        const end = buffer.indexOf("\r\n.\r\n");
        if (end === -1) return;
        exchange.data = buffer.slice(0, end);
        buffer = buffer.slice(end + 5);
        inData = false;
        socket.write("250 queued\r\n");
      }
      let nl: number;
      while ((nl = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        exchange.commands.push(line);
        if (line === "DATA") {
          inData = true;
          socket.write("354 go\r\n");
          break;
        }
        socket.write(line === "QUIT" ? "221 bye\r\n" : "250 ok\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const baseMsg = {
  to: "client@example.com",
  subject: "Hello",
  html: "<p>hi</p>",
  text: "hi",
  idempotencyKey: "booking/1/confirmation",
};

describe("headerValue", () => {
  it("collapses CR/LF runs to a single space", () => {
    expect(headerValue("a\r\nb\nc\r\r\nd")).toBe("a b c d");
    expect(headerValue("plain")).toBe("plain");
  });
});

describe("smtpTransport", () => {
  it("sends From/To/Subject headers and the html body", async () => {
    const transport = smtpTransport("127.0.0.1", port, "Booklo <chase@localhost>");
    await expect(transport.send(baseMsg)).resolves.toEqual({ id: baseMsg.idempotencyKey });
    const ex = exchanges.at(-1)!;
    expect(ex.commands).toEqual([
      "EHLO localhost",
      "MAIL FROM:<chase@localhost>",
      "RCPT TO:<client@example.com>",
      "DATA",
      "QUIT",
    ]);
    expect(ex.data).toContain("From: Booklo <chase@localhost>\r\n");
    expect(ex.data).toContain("To: client@example.com\r\n");
    expect(ex.data).toContain("Subject: Hello\r\n");
    expect(ex.data).not.toContain("Reply-To:");
    expect(ex.data.endsWith("\r\n\r\n<p>hi</p>")).toBe(true);
  });

  it("writes a Reply-To header when the message carries one", async () => {
    const transport = smtpTransport("127.0.0.1", port, "Booklo <chase@localhost>");
    await transport.send({ ...baseMsg, replyTo: "owner@provider.example" });
    expect(exchanges.at(-1)!.data).toContain("Reply-To: owner@provider.example\r\n");
  });

  // A subject is built from org/service names; an address is whatever the
  // client typed. Neither may be allowed to start a new header line, or a
  // new envelope command.
  it("strips CR/LF from every header value and the envelope", async () => {
    const transport = smtpTransport("127.0.0.1", port, "Booklo\r\nX-Injected: 1 <chase@localhost>");
    await transport.send({
      ...baseMsg,
      to: "victim@example.com\r\nRCPT TO:<other@example.com>",
      subject: "Reminder\r\nBcc: spy@example.com",
      replyTo: "a@b.example\nBcc: spy2@example.com",
    });
    const ex = exchanges.at(-1)!;
    expect(ex.commands).toEqual([
      "EHLO localhost",
      "MAIL FROM:<chase@localhost>",
      "RCPT TO:<victim@example.com RCPT TO:<other@example.com>>",
      "DATA",
      "QUIT",
    ]);
    const headers = ex.data.split("\r\n\r\n")[0].split("\r\n");
    expect(headers).toEqual([
      "From: Booklo X-Injected: 1 <chase@localhost>",
      "To: victim@example.com RCPT TO:<other@example.com>",
      "Reply-To: a@b.example Bcc: spy2@example.com",
      "Subject: Reminder Bcc: spy@example.com",
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=utf-8",
    ]);
  });
});
