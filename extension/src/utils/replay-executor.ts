import type { WorkflowAction } from '../types';
import { readTableRecords } from '@browser-agent/shared/dist/table-reader';
import { resolveOne } from './selector-utils';
import { isNexacroSelector, nexacroComponentId, runNexacroAction } from './nexacro';

// Two tiers, not one timeout for every step: click/input/select act on a
// control that should already be on the page, so a wrong selector fails fast
// here. extractText/Table/Json, batchExtract, and screenshot read something
// that may still be loading or may only exist after a search — those get the
// longer allowance. Matches the 30s already used elsewhere for the same
// "page might genuinely take a while" reason (background.ts's
// NAVIGATION_TIMEOUT_MS, the Search node's own default wait).
const INTERACT_TIMEOUT_MS = 10000;
const WAIT_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 100;
// A step marked onError: 'skip'/'ignore' is expected to sometimes not exist
// at all (a popup that doesn't always appear) — background.ts's replay loop
// already treats a thrown error here as non-fatal for such steps, but
// without a shorter wait it still burns the full "this should definitely be
// on the page" timeout on every run where the thing is genuinely absent.
const OPTIONAL_TIMEOUT_MS = 2000;

export interface StepOutput {
  key: string;
  value: unknown;
}

export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptureRequest {
  key: string;
  rect: CaptureRect; // viewport-relative, for cropping a captureVisibleTab frame
  pageRect: CaptureRect; // document-relative, for the devtools clip
  dpr: number;
  /** Larger than the screen, so cropping a photo of the screen cannot contain it. */
  exceedsViewport: boolean;
}

export interface StepResult {
  output?: StepOutput;
  skipped?: string;
  capture?: CaptureRequest; // only the background can take a screenshot
  point?: { x: number; y: number }; // only the background can dispatch a CDP click
}

function query(selector: string): HTMLElement | null {
  if (selector.startsWith('//') || selector.startsWith('xpath=')) {
    const expr = selector.replace(/^xpath=/, '');
    const result = document.evaluate(expr, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return result.singleNodeValue as HTMLElement | null;
  }
  return resolveOne(document, selector) as HTMLElement | null;
}

// Pages rarely have the element ready the instant the previous step finished,
// so every selector-based step polls instead of failing on the first miss, and
// tries the selectors recorded as backups before giving up.
function waitForElement(
  selector: string,
  fallbacks: string[] = [],
  timeout = INTERACT_TIMEOUT_MS,
): Promise<HTMLElement> {
  const all = [selector, ...fallbacks];

  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;

    const attempt = () => {
      for (const candidate of all) {
        const el = query(candidate);
        if (el) {
          resolve(el);
          return;
        }
      }
      if (Date.now() >= deadline) {
        const tried = all.length > 1 ? ` (tried ${all.length} selectors)` : '';
        reject(new Error(`Element not found: ${selector}${tried}`));
        return;
      }
      setTimeout(attempt, POLL_INTERVAL_MS);
    };

    attempt();
  });
}

function locateFor(
  action: { selector: string; selectorFallbacks?: string[] },
  timeout = INTERACT_TIMEOUT_MS,
): Promise<HTMLElement> {
  return waitForElement(action.selector, action.selectorFallbacks ?? [], timeout);
}

async function runNexacroOrThrow(
  selector: string,
  action: 'click' | 'set_value',
  value?: string,
): Promise<void> {
  const result = await runNexacroAction(nexacroComponentId(selector), action, value);
  if (!result.ok) throw new Error(result.error ?? `Nexacro ${action} failed: ${selector}`);
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  // React and friends track the value on the DOM node's own setter; assigning
  // el.value directly leaves their internal state stale and the change is lost.
  const proto = Object.getPrototypeOf(el);
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  descriptor?.set ? descriptor.set.call(el, value) : (el.value = value);

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export async function executeStep(
  action: WorkflowAction & { resolvedValue?: string; cdpPointOnly?: boolean },
): Promise<StepResult> {
  switch (action.type) {
    case 'click': {
      if (isNexacroSelector(action.selector)) {
        await runNexacroOrThrow(action.selector, 'click');
        return {};
      }
      const optional = action.onError === 'skip' || action.onError === 'ignore';
      // A positional fallback (":nth-match(button, 1)") exists to survive
      // small page changes, but an optional step's whole premise is that the
      // page may look structurally different when its target is missing —
      // exactly when a positional fallback is most likely to latch onto some
      // unrelated element instead of correctly reporting "not found".
      const el = optional
        ? await locateFor({ selector: action.selector }, OPTIONAL_TIMEOUT_MS)
        : await locateFor(action);

      // The background asks for the click point only, then dispatches the
      // click itself through the debugger (a trusted event some frameworks
      // require) — see cdp-click.ts. Same scrollIntoView-then-measure shape
      // as the 'screenshot' case below.
      if (action.cdpPointOnly) {
        el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
        await new Promise((resolve) => setTimeout(resolve, 150)); // let the scroll settle before measuring
        const rect = el.getBoundingClientRect();
        return { point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } };
      }

      el.click();
      return {};
    }

    case 'input': {
      if (isNexacroSelector(action.selector)) {
        await runNexacroOrThrow(action.selector, 'set_value', action.value);
        return {};
      }
      const el = await locateFor(action);
      setNativeValue(el as HTMLInputElement, action.value);
      return {};
    }

    case 'select': {
      if (isNexacroSelector(action.selector)) {
        await runNexacroOrThrow(action.selector, 'set_value', action.value);
        return {};
      }
      const el = (await locateFor(action)) as HTMLSelectElement;
      setNativeValue(el, action.value);
      return {};
    }

    case 'wait':
      await new Promise((resolve) => setTimeout(resolve, action.duration));
      return {};

    case 'waitForSelector':
      await waitForElement(action.selector, action.selectorFallbacks ?? [], action.timeout ?? WAIT_TIMEOUT_MS);
      return {};

    case 'extractText': {
      const el = await locateFor(action, WAIT_TIMEOUT_MS);
      return { output: { key: action.output, value: el.textContent?.trim() ?? '' } };
    }

    case 'extractTable': {
      if (isNexacroSelector(action.selector)) {
        const result = await runNexacroAction(nexacroComponentId(action.selector), 'extract_grid');
        if (!result.ok || !result.grid) {
          throw new Error(result.error ?? `Nexacro grid extraction failed: ${action.selector}`);
        }
        const records = result.grid.rows.map((row) => {
          const record: Record<string, string> = {};
          for (const key of Object.keys(row)) record[key] = String(row[key] ?? '');
          return record;
        });
        return { output: { key: action.output, value: records } };
      }
      const el = await locateFor(action, WAIT_TIMEOUT_MS);
      return { output: { key: action.output, value: readTableRecords(el, action.headers) } };
    }

    case 'extractJson': {
      const el = action.selector
        ? await locateFor({ selector: action.selector, selectorFallbacks: action.selectorFallbacks }, WAIT_TIMEOUT_MS)
        : document.body;
      return { output: { key: action.output, value: JSON.parse(el.textContent ?? 'null') } };
    }

    case 'dismissPopup': {
      for (const selector of action.selectors ?? []) {
        query(selector)?.click();
      }
      return {};
    }

    case 'scroll': {
      const positions = { top: 0, bottom: document.body.scrollHeight, center: document.body.scrollHeight / 2 };
      window.scrollTo(0, action.position ? positions[action.position] : (action.pixels ?? 0));
      return {};
    }

    case 'uploadFile':
      // browsers forbid scripts from putting a real file into a file input
      return { skipped: `uploadFile (${action.selector}) needs a real file — run it through the CLI` };

    case 'batchInput': {
      // fileUpload goes through the background's debugger session instead —
      // the same platform restriction as plain `uploadFile` above applies here.
      if (action.inputType === 'fileUpload') return { skipped: 'fileUpload is applied via the debugger, not in-page' };

      const el = await locateFor(action);
      const incoming = action.resolvedValue ?? '';
      const value =
        action.replaceMode === 'keepExisting'
          ? null
          : action.replaceMode === 'append'
            ? (el as HTMLInputElement).value + incoming
            : incoming; // 'replace' (default)

      if (value !== null) setNativeValue(el as HTMLInputElement, value);
      return {};
    }

    case 'batchClick': {
      const el = await locateFor(action);
      el.click();
      return {};
    }

    case 'batchSearch': {
      const el = await locateFor(action);
      el.click();
      const { selector, timeout } = action.waitCondition;
      await waitForElement(selector ?? action.selector, [], timeout);
      return {};
    }

    case 'batchExtract': {
      const el = await locateFor(action, WAIT_TIMEOUT_MS);
      const value =
        action.extractType === 'attribute'
          ? (el.getAttribute(action.attribute ?? '') ?? '')
          : action.extractType === 'value'
            ? (el as HTMLInputElement).value
            : (el.textContent?.trim() ?? '');
      return { output: { key: action.output, value } };
    }

    case 'screenshot': {
      if (!action.selector || !action.output) {
        return { skipped: 'full-page screenshots are only saved when running through the CLI' };
      }

      const el = await locateFor(
        { selector: action.selector, selectorFallbacks: action.selectorFallbacks },
        WAIT_TIMEOUT_MS,
      );
      el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
      await new Promise((resolve) => setTimeout(resolve, 150)); // let the scroll settle before the capture

      const rect = el.getBoundingClientRect();
      return {
        capture: {
          key: action.output,
          rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
          pageRect: {
            x: rect.left + window.scrollX,
            y: rect.top + window.scrollY,
            width: rect.width,
            height: rect.height,
          },
          dpr: window.devicePixelRatio || 1,
          // Scrolling it into view cannot help when it is simply bigger than
          // the view; only a capture that renders past the viewport can hold
          // all of it.
          exceedsViewport: rect.height > window.innerHeight || rect.width > window.innerWidth,
        },
      };
    }

    // apiJsonParse is not here — it reads an earlier step's output, which
    // in-browser replay never threads into this per-step call (see
    // action-display.ts's isCliOnlyAction for why); it falls to the default
    // case below like the Mail/File/Database steps.
    case 'apiGet': {
      const url = new URL(action.url);
      if (action.queryParams) {
        for (const [key, value] of Object.entries(action.queryParams)) url.searchParams.set(key, value);
      }
      const response = await fetch(url, { headers: action.httpHeaders });
      if (!response.ok) throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
      const contentType = response.headers.get('content-type') ?? '';
      const value = contentType.includes('application/json') ? await response.json() : await response.text();
      return { output: { key: action.output, value } };
    }

    case 'apiPost': {
      const asJson = action.json ?? true;
      const response = await fetch(action.url, {
        method: 'POST',
        headers: { ...(asJson ? { 'Content-Type': 'application/json' } : {}), ...action.httpHeaders },
        body: action.body,
      });
      if (!response.ok) throw new Error(`POST ${action.url} failed: ${response.status} ${response.statusText}`);
      const contentType = response.headers.get('content-type') ?? '';
      const value = contentType.includes('application/json') ? await response.json() : await response.text();
      return { output: { key: action.output, value } };
    }

    default:
      return { skipped: `${(action as WorkflowAction).type} is not supported during in-browser replay` };
  }
}
