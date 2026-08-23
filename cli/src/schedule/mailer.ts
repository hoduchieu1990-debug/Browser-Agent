import * as nodemailer from 'nodemailer';
import type { ScheduleEmailConfig, MailMessage } from '@browser-agent/shared';

export type { MailMessage };

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
        // buildReportEmail (shared/report-email.ts) already resolves From to
        // email.from || email.user — resolved once there so the Review tab's
        // preview and the real send never disagree.
        from: message.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        attachments: message.attachments,
      });
    },
  };
}
