import type { MailReadAction } from '@browser-agent/shared';
import { fetchMessages, type MailMessageSummary } from '../utils/mail-client';

export async function mailRead(_page: unknown, action: MailReadAction): Promise<MailMessageSummary[]> {
  return fetchMessages(
    action,
    action.mailbox ?? 'INBOX',
    action.criteria === 'all' ? { all: true } : { seen: false },
    action.limit ?? 10,
    action.markSeen ?? false,
  );
}
