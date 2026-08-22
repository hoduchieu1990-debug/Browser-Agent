import type { Page } from 'playwright';
import type { ScreenshotAction } from '@browser-agent/shared';
import * as path from 'path';
import { resolve } from '../utils/selector-engine';

export async function screenshot(
  page: Page,
  action: ScreenshotAction,
  outputDir: string,
): Promise<string> {
  const filePath = path.join(outputDir, action.filename ?? `screenshot-${action.id}.png`);

  if (action.selector) {
    const el = await resolve(page, action.selector, action.selectorFallbacks);
    await el.screenshot({ path: filePath });
  } else {
    await page.screenshot({ path: filePath });
  }

  return filePath;
}
