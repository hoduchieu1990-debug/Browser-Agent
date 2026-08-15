import type { Page } from 'playwright';
import type { UploadFileAction } from '@browser-agent/shared';
import { locate } from '../utils/selector-engine';

export async function uploadFile(page: Page, action: UploadFileAction): Promise<void> {
  await locate(page, action.selector).setInputFiles(action.value);
}
