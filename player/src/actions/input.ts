import type { Page } from 'playwright';
import type { InputAction } from '@browser-agent/shared';
import { resolve } from '../utils/selector-engine';
import { isNexacroSelector, nexacroSetValue, nexacroComponentId } from '../utils/nexacro';

export async function input(page: Page, action: InputAction): Promise<void> {
  if (isNexacroSelector(action.selector)) {
    await nexacroSetValue(page, nexacroComponentId(action.selector), action.value);
    return;
  }
  const el = await resolve(page, action.selector, action.selectorFallbacks);
  await el.fill(action.value);
}
