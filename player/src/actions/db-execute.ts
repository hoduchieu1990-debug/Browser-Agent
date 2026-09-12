import type { DbExecuteAction } from '@browser-agent/shared';
import { runStatement } from '../utils/db-client';

export async function dbExecute(_page: unknown, action: DbExecuteAction): Promise<number> {
  return runStatement(action.connection, action.statement, action.params);
}
