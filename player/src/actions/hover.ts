import type { Page } from 'playwright';
import type { HoverAction } from '@browser-agent/shared';
import { resolve, WAIT_TIMEOUT_MS } from '../utils/selector-engine';

// A real, OS-level pointer move — unlike the extension's in-browser replay
// (dispatched events only), this also triggers a menu that opens purely via
// CSS :hover with no JS involved at all.
export async function hover(page: Page, action: HoverAction): Promise<void> {
  const el = await resolve(page, action.selector, action.selectorFallbacks, WAIT_TIMEOUT_MS);
  await el.hover();
}
