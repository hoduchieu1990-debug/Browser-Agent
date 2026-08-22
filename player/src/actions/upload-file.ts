import type { Page } from 'playwright';
import type { UploadFileAction } from '@browser-agent/shared';
import { resolve } from '../utils/selector-engine';

export async function uploadFile(page: Page, action: UploadFileAction): Promise<void> {
  const el = await resolve(page, action.selector, action.selectorFallbacks);
  await el.setInputFiles(action.value);
}
