import * as fs from 'fs';
import * as path from 'path';
import { simpleParser } from 'mailparser';
import type { MailAttachmentAction } from '@browser-agent/shared';
import type { RunContext } from '../types';
import { openImapClient, type MailMessageSummary } from '../utils/mail-client';

export async function mailAttachment(
  _page: unknown,
  action: MailAttachmentAction,
  context: RunContext,
): Promise<string[]> {
  const messages = context.variables[action.source] as MailMessageSummary[] | undefined;
  if (!Array.isArray(messages) || messages.length === 0) return [];

  fs.mkdirSync(action.saveDir, { recursive: true });

  const client = openImapClient(action);
  await client.connect();
  const savedPaths: string[] = [];

  try {
    const lock = await client.getMailboxLock(action.mailbox ?? 'INBOX');
    try {
      const uids = messages.map((m) => m.uid);
      for await (const msg of client.fetch(uids, { uid: true, source: true }, { uid: true })) {
        if (!msg.source) continue;
        const parsed = await simpleParser(msg.source);
        for (const attachment of parsed.attachments) {
          const filePath = path.join(action.saveDir, attachment.filename ?? `attachment-${msg.uid}`);
          fs.writeFileSync(filePath, attachment.content);
          savedPaths.push(filePath);
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }

  return savedPaths;
}
