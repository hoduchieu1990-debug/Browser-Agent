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
//
// A Nexacro-rendered id is the component's full dotted object-model path
// (mainframe.WorkFrame.form...TextField00), sometimes with a trailing
// DOM-only rendering suffix ("box:simpleinput") that isn't a public
// property — only the very last segment is allowed to miss for that reason.
// A miss on any earlier segment means the component tree isn't fully built
// yet (real, right after a fresh navigation — verified against a live
// Nexacro N app: the walk lands on a still-attaching parent Form instead of
// the target TextField for about a second), so that must resolve to nothing
// rather than the shallower parent, or waitForComponent's poll below would
// treat a half-booted page as "found" and every function here would then act
// on the wrong component. window.nexacro.getActiveFrame(), used here
// previously, does not exist on real Nexacro N.
//
// Each function below repeats this walk inline (rather than sharing one
// helper) because page.evaluate() serializes only the function it's given —
// it can't close over another module-level function.
function resolveInPage(id: string): unknown {
  const app = (window as any).nexacro?.getApplication?.();
  if (!app) return null;
  const parts = id.replace(/:[^:.]*$/, '').split('.');
  let obj: any = app;
  for (let i = 0; i < parts.length; i++) {
    const next = obj?.[parts[i]];
    if (next === undefined) return i === parts.length - 1 ? obj : null;
    obj = next;
  }
  return obj;
}

// A Nexacro app can take several seconds after page load before
// getApplication()'s component tree is fully populated (observed ~8s on a
// real, heavy Nexacro N app) — long enough that the previous 10s default cut
// it close.
async function waitForComponent(page: Page, componentId: string, timeout = 15000): Promise<void> {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const found = await page.evaluate(resolveInPage, componentId);
    if (found) return;
    await page.waitForTimeout(100);
  }

  throw new Error(`Nexacro component not found: ${componentId}`);
}

export async function nexacroClick(page: Page, componentId: string): Promise<void> {
  await waitForComponent(page, componentId);
  await page.evaluate(({ id }) => {
    const app = (window as any).nexacro?.getApplication?.();
    const parts = id.replace(/:[^:.]*$/, '').split('.');
    let obj: any = app;
    let comp: any = null;
    for (let i = 0; i < parts.length; i++) {
      const next = obj?.[parts[i]];
      if (next === undefined) {
        comp = i === parts.length - 1 ? obj : null;
        break;
      }
      obj = next;
      comp = obj;
    }
    if (!comp) return;
    comp.click?.();
    // A real component's onclick is a Nexacro EventHandler object, not a
    // plain function — calling it unconditionally throws. click() alone
    // already runs the component's own click handling.
    if (typeof comp.onclick === 'function') comp.onclick();
  }, { id: componentId });
}

export async function nexacroSetValue(page: Page, componentId: string, value: string): Promise<void> {
  await waitForComponent(page, componentId);
  await page.evaluate(
    ({ id, value }) => {
      const app = (window as any).nexacro?.getApplication?.();
      const parts = id.replace(/:[^:.]*$/, '').split('.');
      let obj: any = app;
      let comp: any = null;
      for (let i = 0; i < parts.length; i++) {
        const next = obj?.[parts[i]];
        if (next === undefined) {
          comp = i === parts.length - 1 ? obj : null;
          break;
        }
        obj = next;
        comp = obj;
      }
      if (!comp) return;
      comp.set_value?.(value);
      comp.setFocus?.();
      if (typeof comp.onchange === 'function') comp.onchange();
    },
    { id: componentId, value },
  );
}

export async function nexacroGetValue(page: Page, componentId: string): Promise<string> {
  await waitForComponent(page, componentId);
  return page.evaluate((id) => {
    const app = (window as any).nexacro?.getApplication?.();
    const parts = id.replace(/:[^:.]*$/, '').split('.');
    let obj: any = app;
    let comp: any = null;
    for (let i = 0; i < parts.length; i++) {
      const next = obj?.[parts[i]];
      if (next === undefined) {
        comp = i === parts.length - 1 ? obj : null;
        break;
      }
      obj = next;
      comp = obj;
    }
    return String(comp?.value ?? comp?.get_value?.() ?? '');
  }, componentId);
}
