import * as nodemailer from 'nodemailer';
import type { MailSendAction } from '@browser-agent/shared';

export async function mailSend(_page: unknown, action: MailSendAction): Promise<void> {
  const transport = nodemailer.createTransport({
    host: action.host,
    port: action.port,
    secure: action.secure ?? action.port === 465,
    // Some internal relays (SMTP_Secure=false, port 25) accept mail from
    // trusted hosts with no auth at all — only set it when both fields are
    // actually filled in, rather than sending an empty-string login.
    auth: action.user && action.password ? { user: action.user, pass: action.password } : undefined,
  });

  await transport.sendMail({
    from: action.user,
    to: action.to,
    cc: action.cc,
    bcc: action.bcc,
    subject: action.subject,
    text: action.html ? undefined : action.body,
    html: action.html ? action.body : undefined,
    attachments: action.attachments?.map((a) => ({ filename: a.filename, path: a.filePath })),
  });
}
