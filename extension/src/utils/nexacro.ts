import { NEXACRO_SELECTOR_PREFIX } from '@browser-agent/shared/dist/constants';

// Mirrors the attributes nexacro-bridge.ts (running in the page's own JS
// world) stamps onto each component's real DOM element, so hover detection
// here stays a plain, synchronous DOM lookup instead of round-tripping to
// the other world on every mousemove.
const MARK_ATTR = 'data-ba-nexacro-id';
const TYPE_ATTR = 'data-ba-nexacro-type';
const MARKING_EVENT = '__ba_nexacro_marking__';
const REQUEST_EVENT = '__ba_nexacro_request__';
const RESPONSE_EVENT = '__ba_nexacro_response__';
const BRIDGE_SCRIPT_ID = '__browser_agent_nexacro_bridge__';
// Longer than the bridge's own internal component-resolve deadline (15s,
// nexacro-bridge.ts) so a slow-booting app gets to use all of it instead of
// this timing out first.
const REQUEST_TIMEOUT_MS = 20000;

export interface NexacroComponentRef {
  id: string;
  type: string;
  element: HTMLElement;
}

export interface NexacroActionResult {
  ok: boolean;
  error?: string;
  value?: string;
  grid?: { rows: Record<string, unknown>[] };
}

// A <script src> tag loads and executes asynchronously — dispatching a
// CustomEvent right after appending it (rather than waiting for 'load') would
// almost always fire before the bridge has registered its listener, and the
// event is silently lost.
let bridgeReady: Promise<void> | null = null;

function ensureBridgeInjected(): Promise<void> {
  if (bridgeReady) return bridgeReady;

  bridgeReady = new Promise((resolve) => {
    if (document.getElementById(BRIDGE_SCRIPT_ID)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.id = BRIDGE_SCRIPT_ID;
    script.src = chrome.runtime.getURL('nexacro-bridge.js');
    script.addEventListener('load', () => {
      script.remove();
      resolve();
    });
    // A page without web_accessible_resources access (shouldn't happen, ours
    // matches <all_urls>) would fail to load — resolving anyway means callers
    // get a clean "component not found" instead of hanging forever.
    script.addEventListener('error', () => resolve());
    (document.documentElement || document.head || document.body).appendChild(script);
  });

  return bridgeReady;
}

export function setNexacroMarking(enabled: boolean): void {
  ensureBridgeInjected().then(() => {
    document.dispatchEvent(new CustomEvent(MARKING_EVENT, { detail: { enabled } }));
  });
}

function markedAncestor(el: Element | null): NexacroComponentRef | null {
  const marked = el?.closest?.(`[${MARK_ATTR}]`) as HTMLElement | null;
  if (!marked) return null;
  const id = marked.getAttribute(MARK_ATTR);
  if (!id) return null;
  return { id, type: marked.getAttribute(TYPE_ATTR) ?? '', element: marked };
}

/**
 * What a click or a typed value should target.
 *
 * A Grid is addressable as a whole — that's how its dataset gets read, see
 * findNexacroGrid — but everything drawn inside one (rows, cells, and the
 * tree items and checkboxes rendered in them) is an artifact of the grid's
 * rendering rather than a component in its own right. Resolving those up to
 * the Grid would record "click the whole grid" for what the user did to a
 * single row, so they fall through to a CSS selector aimed at that exact
 * node instead. That matches how a production Nexacro automation tool drives
 * them: by DOM click, never through the component API.
 */
export function findNexacroComponent(el: Element | null): NexacroComponentRef | null {
  const hit = markedAncestor(el);
  if (!hit) return null;
  if (hit.type === 'Grid' && hit.element !== el) return null;
  return hit;
}

/**
 * Table extraction only: a cell resolves up to the Grid that owns it, since
 * the rows come from the Grid's bound dataset rather than the DOM.
 */
export function findNexacroGrid(el: Element | null): NexacroComponentRef | null {
  const hit = markedAncestor(el);
  return hit?.type === 'Grid' ? hit : null;
}

let requestCounter = 0;

export async function runNexacroAction(
  componentId: string,
  action: 'click' | 'set_value' | 'get_value' | 'extract_grid',
  value?: string,
): Promise<NexacroActionResult> {
  await ensureBridgeInjected();
  const requestId = `${Date.now()}-${++requestCounter}`;

  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      document.removeEventListener(RESPONSE_EVENT, handleResponse);
      resolve({ ok: false, error: 'Nexacro bridge did not respond in time' });
    }, REQUEST_TIMEOUT_MS);

    function handleResponse(event: Event): void {
      const detail = (event as CustomEvent).detail;
      if (detail.requestId !== requestId) return;
      window.clearTimeout(timer);
      document.removeEventListener(RESPONSE_EVENT, handleResponse);
      resolve(detail);
    }

    document.addEventListener(RESPONSE_EVENT, handleResponse);
    document.dispatchEvent(new CustomEvent(REQUEST_EVENT, { detail: { requestId, componentId, action, value } }));
  });
}

export function nexacroSelector(componentId: string): string {
  return `${NEXACRO_SELECTOR_PREFIX}${componentId}`;
}

export function isNexacroSelector(selector: string): boolean {
  return selector.startsWith(NEXACRO_SELECTOR_PREFIX);
}

export function nexacroComponentId(selector: string): string {
  return selector.slice(NEXACRO_SELECTOR_PREFIX.length);
}

// Nexacro renders its own mouse cursor as a real DOM element that tracks the
// pointer — confirmed on a live app, a 150x150 pointer-events:auto div
// sitting over whatever is under the cursor near a text field, presumably
// so it can relay the click into its own component tree before the real
// target gets it. The browser's own hit-testing lands on it first, same as
// a real user's click would, so without this a click meant for whatever is
// underneath instead captures "the mouse cursor icon" — never something
// meaningful to record.
export function isNexacroVirtualCursor(el: Element | null): boolean {
  return !!el?.id?.includes('__virtual_mouse');
}
