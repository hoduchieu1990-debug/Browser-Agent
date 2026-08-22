import type { Page } from 'playwright';
import type { BatchExtractAction } from '@browser-agent/shared';
import { resolve } from '../utils/selector-engine';

export async function batchExtract(page: Page, action: BatchExtractAction): Promise<string> {
  const el = await resolve(page, action.selector, action.selectorFallbacks);

  if (action.extractType === 'attribute') {
    return (await el.getAttribute(action.attribute ?? '')) ?? '';
  }
  if (action.extractType === 'value') {
    return el.inputValue();
  }

  const text = await el.textContent();
  if (text === null) throw new Error(`No element found for batchExtract at selector "${action.selector}"`);
  return text.trim();
}
