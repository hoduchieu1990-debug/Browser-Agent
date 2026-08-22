import type { Page } from 'playwright';
import type { BatchInputAction } from '@browser-agent/shared';
import type { RunContext } from '../types';
import { resolve } from '../utils/selector-engine';

// The dataset row is already sitting in context.params (that's what makes a
// batch run a batch run) — no ${column} templating needed, the node just
// reads its own column straight out of it.
export async function batchInput(page: Page, action: BatchInputAction, context: RunContext): Promise<void> {
  const value = context.params[action.column] ?? '';
  const el = await resolve(page, action.selector, action.selectorFallbacks);

  if (action.inputType === 'fileUpload') {
    await el.setInputFiles(value);
    return;
  }
  if (action.inputType === 'select') {
    await el.selectOption(value);
    return;
  }

  switch (action.replaceMode ?? 'replace') {
    case 'keepExisting':
      return;
    case 'append': {
      const existing = await el.inputValue();
      await el.fill(existing + value);
      return;
    }
    default: // 'replace' — Playwright's fill() already clears the field first
      await el.fill(value);
  }
}
