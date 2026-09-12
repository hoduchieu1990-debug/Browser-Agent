import type { ApiJsonParseAction } from '@browser-agent/shared';
import type { RunContext } from '../types';

export async function apiJsonParse(
  _page: unknown,
  action: ApiJsonParseAction,
  context: RunContext,
): Promise<unknown> {
  const raw = context.variables[action.input];
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!action.path) return parsed;
  return action.path.split('.').reduce((value: any, key) => value?.[key], parsed);
}
