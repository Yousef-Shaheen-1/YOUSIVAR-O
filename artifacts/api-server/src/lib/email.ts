import { once } from "node:events";
import net from "node:net";
import { randomUUID } from "node:crypto";
import tls from "node:tls";

/**
 * Transactional email delivery for owner verification codes.
 *
 * Two providers are supported, both configured exclusively through server-side
 * secrets:
 *   - Resend (`RESEND_API_KEY`, optional `MAIL_FROM`) over HTTPS.
 *   - SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, optional
 *     `MAIL_FROM`) over implicit TLS (465) or STARTTLS (587/25).
 *
 * Nothing here ever logs or returns credentials. When no provider is
 * configured, callers get an `EmailDeliveryError` explaining exactly which
 * variable is missing so the UI can say the code was NOT sent.
 */

export type EmailProvider = "resend" | "smtp";

export type EmailReadiness = {
  configured: boolean;
  provider: EmailProvider | null;
  detail: string;
};

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
};

export class EmailDeliveryError extends Error {
  readonly status = 503;

  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "EmailDeliveryError";
  }
}

const NOT_CONFIGURED_MESSAGE =
  "Email delivery is not configured, so no verification code was sent. Set RESEND_API_KEY, or SMTP_HOST with SMTP_USER and SMTP_PASSWORD, as app secrets.";

const DELIVERY_FAILED_MESSAGE =
  "The verification email could not be delivered, so no working code was issued. Check the mail provider configuration and try again.";

type SmtpSettings = {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
};

function smtpSettings(): SmtpSettings | null {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return null;
  const parsedPort = Number.parseInt(process.env.SMTP_PORT ?? "", 10);
  const user = process.env.SMTP_USER?.trim() ?? "";
  return {
    host,
    port: Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 587,
    user,
    password: process.env.SMTP_PASSWORD ?? "",
    from: senderAddress() || user,
  };
}

function senderAddress(): string {
  return (process.env.MAIL_FROM ?? process.env.SMTP_FROM ?? "").trim();
}

function resendFrom(): string {
  return senderAddress() || "YOUSIVAR–Ω <onboarding@resend.dev>";
}

export function emailReadiness(): EmailReadiness {
  if (process.env.RESEND_API_KEY?.trim()) {
    return {
      configured: true,
      provider: "resend",
      detail: "Verification codes are delivered through Resend.",
    };
  }
  const smtp = smtpSettings();
  if (smtp) {
    return {
      configured: true,
      provider: "smtp",
      detail: `Verification codes are delivered over SMTP (${smtp.host}:${smtp.port}).`,
    };
  }
  return { configured: false, provider: null, detail: NOT_CONFIGURED_MESSAGE };
}

export async function sendEmail(message: OutgoingEmail): Promise<EmailProvider> {
  if (process.env.RESEND_API_KEY?.trim()) {
    await sendViaResend(process.env.RESEND_API_KEY.trim(), message);
    return "resend";
  }
  const smtp = smtpSettings();
  if (smtp) {
    await sendViaSmtp(smtp, message);
    return "smtp";
  }
  throw new EmailDeliveryError(NOT_CONFIGURED_MESSAGE);
}

async function sendViaResend(apiKey: string, message: OutgoingEmail): Promise<void> {
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: resendFrom(),
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
    });
  } catch (error) {
    throw new EmailDeliveryError(DELIVERY_FAILED_MESSAGE, error);
  }
  if (!response.ok) {
    throw new EmailDeliveryError(
      DELIVERY_FAILED_MESSAGE,
      new Error(`Resend responded with HTTP ${response.status}`),
    );
  }
}

type SmtpReply = { code: number; lines: string[] };

/**
 * Minimal line-oriented SMTP reader: resolves on the final line of a reply
 * (`250 text`), while `250-text` continues the same reply.
 */
function attachReader(socket: net.Socket, label: string) {
  let buffer = "";
  let pending:
    | { resolve: (reply: SmtpReply) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
    | null = null;

  const settle = (error?: Error, reply?: SmtpReply) => {
    if (!pending) return;
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    if (error) current.reject(error);
    else current.resolve(reply as SmtpReply);
  };

  const drain = () => {
    if (!pending) return;
    const lines = buffer.split("\r\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] as string;
      if (!/^\d{3} /.test(line)) continue;
      buffer = lines.slice(index + 1).join("\r\n");
      settle(undefined, { code: Number(line.slice(0, 3)), lines: lines.slice(0, index + 1) });
      drain();
      return;
    }
  };

  socket.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    drain();
  });
  socket.on("error", (error: Error) =>
    settle(new Error(`SMTP connection error during ${label}: ${error.message}`)),
  );
  socket.on("close", () => settle(new Error(`SMTP connection closed during ${label}`)));

  return () =>
    new Promise<SmtpReply>((resolve, reject) => {
      pending = {
        resolve,
        reject,
        timer: setTimeout(
          () => settle(new Error(`SMTP response timed out during ${label}`)),
          15_000,
        ),
      };
      pending.timer.unref();
      drain();
    });
}

async function sendViaSmtp(settings: SmtpSettings, message: OutgoingEmail): Promise<void> {
  const implicitTls = settings.port === 465;
  let socket: net.Socket = implicitTls
    ? tls.connect({ host: settings.host, port: settings.port, servername: settings.host })
    : net.connect({ host: settings.host, port: settings.port });

  try {
    await once(socket, implicitTls ? "secureConnect" : "connect");
    let read = attachReader(socket, "greeting");

    const write = (line: string) => socket.write(`${line}\r\n`);
    const command = async (line: string, accepted: number[], label: string) => {
      write(line);
      const reply = await read();
      if (!accepted.includes(reply.code)) {
        throw new Error(`${label} was refused with SMTP status ${reply.code}`);
      }
      return reply;
    };
    const greet = async () => {
      write("EHLO yousivar.local");
      let reply = await read();
      if (reply.code >= 400) {
        write("HELO yousivar.local");
        reply = await read();
        if (reply.code >= 400) throw new Error(`SMTP greeting was refused (${reply.code})`);
      }
      return reply;
    };

    const greeting = await read();
    if (greeting.code !== 220) {
      throw new Error(`SMTP server did not greet correctly (${greeting.code})`);
    }

    let capabilities = (await greet()).lines.join(" ").toUpperCase();
    if (!implicitTls && capabilities.includes("STARTTLS")) {
      await command("STARTTLS", [220], "STARTTLS");
      socket = tls.connect({ socket, servername: settings.host });
      await once(socket, "secureConnect");
      read = attachReader(socket, "TLS session");
      capabilities = (await greet()).lines.join(" ").toUpperCase();
    }

    if (settings.user) {
      if (capabilities.includes("PLAIN")) {
        const payload = Buffer.from(`\0${settings.user}\0${settings.password}`).toString("base64");
        await command(`AUTH PLAIN ${payload}`, [235], "Authentication");
      } else {
        await command("AUTH LOGIN", [334], "Authentication");
        await command(Buffer.from(settings.user).toString("base64"), [334], "Authentication");
        await command(Buffer.from(settings.password).toString("base64"), [235], "Authentication");
      }
    }

    await command(`MAIL FROM:<${bareAddress(settings.from)}>`, [250], "Sender");
    await command(`RCPT TO:<${message.to}>`, [250, 251], "Recipient");
    await command("DATA", [354], "Message data");
    write(stuffDots(buildMessage(settings.from, message)));
    // End of data: the terminating dot is written separately so dot-stuffing
    // never doubles it (a doubled dot means the server keeps waiting).
    write(".");
    const accepted = await read();
    if (accepted.code !== 250) {
      throw new Error(`The mail server rejected the message (${accepted.code})`);
    }
    write("QUIT");
  } catch (error) {
    throw new EmailDeliveryError(DELIVERY_FAILED_MESSAGE, error);
  } finally {
    socket.end();
    socket.destroy();
  }
}

/** Extracts the bare address from `Name <address>` for MAIL FROM. */
function bareAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  const address = (match?.[1] ?? from).trim();
  return address.includes("@") ? address : "";
}

function encodeSubject(subject: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7E]*$/.test(subject)
    ? subject
    : `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
}

function buildMessage(from: string, message: OutgoingEmail): string {
  const headers = [
    `From: ${from}`,
    `To: ${message.to}`,
    `Subject: ${encodeSubject(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@yousivar.omega>`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
  ];
  const body = Buffer.from(message.text, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

function stuffDots(payload: string): string {
  return payload
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}
