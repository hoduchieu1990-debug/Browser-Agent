import type { Page } from 'playwright';
import type { ExtractTextAction } from '@browser-agent/shared';
import { resolve, WAIT_TIMEOUT_MS } from '../utils/selector-engine';

export async function extractText(page: Page, action: ExtractTextAction): Promise<string> {
  const el = await resolve(page, action.selector, action.selectorFallbacks, WAIT_TIMEOUT_MS);
  const text = await el.textContent();
  return (text ?? '').trim();
}
