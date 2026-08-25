import type { Page } from 'playwright';
import type { ClickAction } from '@browser-agent/shared';
import { resolve, INTERACT_TIMEOUT_MS } from '../utils/selector-engine';
import { isNexacroSelector, nexacroClick, nexacroComponentId } from '../utils/nexacro';

// A step marked onError: 'skip'/'ignore' is expected to sometimes not exist
// at all (a popup that doesn't always appear) — ActionExecutor already
// treats a thrown error here as non-fatal for such steps, but without a
// shorter wait it still burns the full "this should definitely be on the
// page" timeout on every run where the thing is genuinely absent.
const OPTIONAL_TIMEOUT_MS = 2000;

export async function click(page: Page, action: ClickAction): Promise<void> {
  if (isNexacroSelector(action.selector)) {
    await nexacroClick(page, nexacroComponentId(action.selector));
    return;
  }
  const optional = action.onError === 'skip' || action.onError === 'ignore';
  // A positional fallback (":nth-match(button, 1)") exists to survive small
  // page changes, but an optional step's whole premise is that the page may
  // look structurally different when its target is missing — exactly when a
  // positional fallback is most likely to latch onto some unrelated element
  // instead of correctly reporting "not found".
  const el = optional
    ? await resolve(page, action.selector, [], OPTIONAL_TIMEOUT_MS)
    : await resolve(page, action.selector, action.selectorFallbacks, INTERACT_TIMEOUT_MS);
  await el.click();
}
