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
const REQUEST_TIMEOUT_MS = 5000;

export interface NexacroComponentRef {
  id: string;
  type: string;
  element: HTMLElement;
}

export interface NexacroActionResult {
  ok: boolean;
  error?: string;
  value?: string;
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

export function findNexacroComponent(el: Element | null): NexacroComponentRef | null {
  const marked = el?.closest?.(`[${MARK_ATTR}]`) as HTMLElement | null;
  if (!marked) return null;
  const id = marked.getAttribute(MARK_ATTR);
  if (!id) return null;
  return { id, type: marked.getAttribute(TYPE_ATTR) ?? '', element: marked };
}

let requestCounter = 0;

export async function runNexacroAction(
  componentId: string,
  action: 'click' | 'set_value' | 'get_value',
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
