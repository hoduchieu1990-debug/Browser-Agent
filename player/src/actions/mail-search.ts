import type { SearchObject } from 'imapflow';
import type { MailSearchAction } from '@browser-agent/shared';
import { fetchMessages, type MailMessageSummary } from '../utils/mail-client';

export async function mailSearch(_page: unknown, action: MailSearchAction): Promise<MailMessageSummary[]> {
  const query: SearchObject = {};
  if (action.from) query.from = action.from;
  if (action.subject) query.subject = action.subject;
  if (action.since) query.since = action.since;
  if (action.unseen) query.seen = false;
  if (Object.keys(query).length === 0) query.all = true;

  return fetchMessages(action, action.mailbox ?? 'INBOX', query, action.limit ?? 10);
}
