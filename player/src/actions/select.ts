import type { Page } from 'playwright';
import type { SelectAction } from '@browser-agent/shared';
import { resolve } from '../utils/selector-engine';
import { isNexacroSelector, nexacroSetValue, nexacroComponentId } from '../utils/nexacro';

export async function select(page: Page, action: SelectAction): Promise<void> {
  if (isNexacroSelector(action.selector)) {
    await nexacroSetValue(page, nexacroComponentId(action.selector), action.value);
    return;
  }
  const el = await resolve(page, action.selector, action.selectorFallbacks);
  await el.selectOption(action.value);
}
