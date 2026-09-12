import { ImapFlow, type SearchObject } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { MailConnection } from '@browser-agent/shared';

export interface MailMessageSummary {
  uid: number;
  from: string;
  subject: string;
  date: string | null;
  text: string;
  hasAttachments: boolean;
}

// Both mailRead and mailSearch open a mailbox, run one search, and parse the
// matches the same way — the only difference is which SearchObject they pass
// in. Sharing this keeps the connect/lock/logout lifecycle in one place: get
// it wrong (an unreleased lock, a missing logout) and connections pile up on
// the server across a long-running workflow.
export function openImapClient(conn: MailConnection): ImapFlow {
  return new ImapFlow({
    host: conn.host,
    port: conn.port,
    secure: conn.secure ?? conn.port === 993,
    auth: conn.user && conn.password ? { user: conn.user, pass: conn.password } : undefined,
    logger: false,
  });
}

export async function fetchMessages(
  conn: MailConnection,
  mailbox: string,
  query: SearchObject,
  limit: number,
  markSeen = false,
): Promise<MailMessageSummary[]> {
  const client = openImapClient(conn);

  await client.connect();
  try {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const uids = await client.search(query, { uid: true });
      if (!uids || uids.length === 0) return [];

      // Newest first, capped at `limit`.
      const targetUids = uids.slice(-limit).reverse();
      const messages: MailMessageSummary[] = [];

      for await (const msg of client.fetch(targetUids, { uid: true, source: true }, { uid: true })) {
        if (!msg.source) continue;
        const parsed = await simpleParser(msg.source);
        messages.push({
          uid: msg.uid,
          from: parsed.from?.text ?? '',
          subject: parsed.subject ?? '',
          date: parsed.date ? parsed.date.toISOString() : null,
          text: (parsed.text ?? '').trim(),
          hasAttachments: (parsed.attachments?.length ?? 0) > 0,
        });
      }

      if (markSeen) await client.messageFlagsAdd(targetUids, ['\\Seen'], { uid: true });

      return messages;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}
