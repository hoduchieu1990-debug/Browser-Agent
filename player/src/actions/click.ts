import type { Page } from 'playwright';
import type { ClickAction } from '@browser-agent/shared';
import { resolve } from '../utils/selector-engine';
import { isNexacroSelector, nexacroClick, nexacroComponentId } from '../utils/nexacro';

export async function click(page: Page, action: ClickAction): Promise<void> {
  if (isNexacroSelector(action.selector)) {
    await nexacroClick(page, nexacroComponentId(action.selector));
    return;
  }
  const el = await resolve(page, action.selector, action.selectorFallbacks);
  await el.click();
}
