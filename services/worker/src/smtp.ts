import { createTransport } from "nodemailer";
import type { Mail, Mailer } from "./email.js";

export interface SmtpConfig { host: string; port: number; from: string; user?: string; password?: string; requireTls: boolean }

/** Sends through the organisation's internal mail relay. */
export class SmtpMailer implements Mailer {
  private transport;
  constructor(private cfg: SmtpConfig) {
    this.transport = createTransport({
      host: cfg.host,
      port: cfg.port,
      // The relay must offer TLS unless the platform team turns this off for a test relay.
      requireTLS: cfg.requireTls,
      ignoreTLS: !cfg.requireTls,
      auth: cfg.user ? { user: cfg.user, pass: cfg.password ?? "" } : undefined,
    });
  }
  async send(mail: Mail) {
    await this.transport.sendMail({ from: this.cfg.from, to: mail.to, subject: mail.subject, text: mail.text });
  }
}
