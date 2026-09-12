import type { DbQueryAction } from '@browser-agent/shared';
import { runQuery } from '../utils/db-client';

export async function dbQuery(_page: unknown, action: DbQueryAction): Promise<Record<string, unknown>[]> {
  return runQuery(action.connection, action.query, action.params);
}
