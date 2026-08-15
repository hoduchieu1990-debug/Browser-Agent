import type { WorkflowAction } from '../types';
import { extractTableHeaders } from './table-utils';
import { resolveOne } from './selector-utils';

// Client-rendered pages finish well after load, and a background window is
// timer-throttled on top of that.
const ELEMENT_TIMEOUT_MS = 12000;
const POLL_INTERVAL_MS = 100;

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
}

export interface StepResult {
  output?: StepOutput;
  skipped?: string;
  capture?: CaptureRequest; // only the background can take a screenshot
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
  timeout = ELEMENT_TIMEOUT_MS,
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

function locateFor(action: { selector: string; selectorFallbacks?: string[] }): Promise<HTMLElement> {
  return waitForElement(action.selector, action.selectorFallbacks ?? []);
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

function readTable(table: HTMLTableElement, headers?: string[]): Record<string, string>[] {
  const columns = headers?.length ? headers : extractTableHeaders(table);
  const rows: Record<string, string>[] = [];

  for (const row of Array.from(table.querySelectorAll('tr'))) {
    const cells = Array.from(row.querySelectorAll('td'));
    if (cells.length === 0) continue;

    const record: Record<string, string> = {};
    cells.forEach((cell, i) => {
      record[columns[i] ?? `column${i + 1}`] = cell.textContent?.trim() ?? '';
    });
    rows.push(record);
  }

  return rows;
}

export async function executeStep(action: WorkflowAction): Promise<StepResult> {
  switch (action.type) {
    case 'click': {
      const el = await locateFor(action);
      el.click();
      return {};
    }

    case 'input': {
      const el = await locateFor(action);
      setNativeValue(el as HTMLInputElement, action.value);
      return {};
    }

    case 'select': {
      const el = (await locateFor(action)) as HTMLSelectElement;
      setNativeValue(el, action.value);
      return {};
    }

    case 'wait':
      await new Promise((resolve) => setTimeout(resolve, action.duration));
      return {};

    case 'waitForSelector':
      await waitForElement(action.selector, action.selectorFallbacks ?? [], action.timeout ?? ELEMENT_TIMEOUT_MS);
      return {};

    case 'extractText': {
      const el = await locateFor(action);
      return { output: { key: action.output, value: el.textContent?.trim() ?? '' } };
    }

    case 'extractTable': {
      const el = (await locateFor(action)) as HTMLTableElement;
      return { output: { key: action.output, value: readTable(el, action.headers) } };
    }

    case 'extractJson': {
      const el = action.selector
        ? await locateFor({ selector: action.selector, selectorFallbacks: action.selectorFallbacks })
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

    case 'screenshot': {
      if (!action.selector || !action.output) {
        return { skipped: 'full-page screenshots are only saved when running through the CLI' };
      }

      const el = await locateFor({ selector: action.selector, selectorFallbacks: action.selectorFallbacks });
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
        },
      };
    }

    default:
      return { skipped: `${(action as WorkflowAction).type} is not supported during in-browser replay` };
  }
}
