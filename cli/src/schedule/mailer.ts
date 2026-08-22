import * as nodemailer from 'nodemailer';
import type { ScheduleEmailConfig } from '@browser-agent/shared';

export interface MailMessage {
  to: string;
  from?: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; path: string }[];
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export function createSmtpMailer(email: ScheduleEmailConfig): Mailer {
  const transport = nodemailer.createTransport({
    host: email.host,
    port: email.port,
    secure: email.secure,
    // Some internal relays (the SMTP_Secure=false, port 25 kind) accept mail
    // from trusted hosts with no auth at all — only set it when both fields
    // are actually filled in, rather than sending an empty-string login.
    auth: email.user && email.pass ? { user: email.user, pass: email.pass } : undefined,
  });

  return {
    async send(message: MailMessage): Promise<void> {
      await transport.sendMail({
        from: message.from ?? email.from ?? email.user,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        attachments: message.attachments,
      });
    },
  };
}
