import type { Page } from 'playwright';
import { NEXACRO_SELECTOR_PREFIX } from '@browser-agent/shared';

export function isNexacroSelector(selector: string): boolean {
  return selector.startsWith(NEXACRO_SELECTOR_PREFIX);
}

export function nexacroComponentId(selector: string): string {
  return selector.slice(NEXACRO_SELECTOR_PREFIX.length);
}

// Playwright's page.evaluate() runs in the page's real JS context (unlike the
// extension's content script, which is stuck in an isolated world) — no
// bridge needed here, window.nexacro is reachable directly.
async function waitForComponent(page: Page, componentId: string, timeout = 10000): Promise<void> {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const found = await page.evaluate((id) => {
      const frm = (window as any).nexacro?.getActiveFrame?.();
      return !!frm?.lookup?.(id);
    }, componentId);
    if (found) return;
    await page.waitForTimeout(100);
  }

  throw new Error(`Nexacro component not found: ${componentId}`);
}

export async function nexacroClick(page: Page, componentId: string): Promise<void> {
  await waitForComponent(page, componentId);
  await page.evaluate((id) => {
    const comp = (window as any).nexacro.getActiveFrame().lookup(id);
    comp.click?.();
    comp.onclick?.();
  }, componentId);
}

export async function nexacroSetValue(page: Page, componentId: string, value: string): Promise<void> {
  await waitForComponent(page, componentId);
  await page.evaluate(
    ({ id, value }) => {
      const comp = (window as any).nexacro.getActiveFrame().lookup(id);
      comp.set_value?.(value);
      comp.setFocus?.();
      comp.onchange?.();
    },
    { id: componentId, value },
  );
}

export async function nexacroGetValue(page: Page, componentId: string): Promise<string> {
  await waitForComponent(page, componentId);
  return page.evaluate((id) => {
    const comp = (window as any).nexacro.getActiveFrame().lookup(id);
    return String(comp?.value ?? comp?.get_value?.() ?? '');
  }, componentId);
}
