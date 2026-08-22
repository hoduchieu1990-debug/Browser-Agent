// Injected via <script src> into the page's own JS world — this is the only
// way to reach window.nexacro, since MV3 content scripts run in an isolated
// world that shares the DOM but not globals. Communication with the content
// script happens over CustomEvents on `document`, which both worlds can see.
const MARK_ATTR = 'data-ba-nexacro-id';
const TYPE_ATTR = 'data-ba-nexacro-type';
const MARKING_EVENT = '__ba_nexacro_marking__';
const REQUEST_EVENT = '__ba_nexacro_request__';
const RESPONSE_EVENT = '__ba_nexacro_response__';

interface NexacroComponent {
  _type?: string;
  constructor: { name?: string };
  value?: unknown;
  click?: () => void;
  onclick?: () => void;
  set_value?: (value: string) => void;
  get_value?: () => unknown;
  setFocus?: () => void;
  onchange?: () => void;
  getDOMElement?: () => Element | null | undefined;
}

interface NexacroFrame {
  components: Record<string, NexacroComponent>;
  lookup: (id: string) => NexacroComponent | null | undefined;
}

function getFrame(): NexacroFrame | null {
  const nexacro = (window as any).nexacro;
  return nexacro?.getActiveFrame?.() ?? null;
}

function syncComponents(): void {
  const frm = getFrame();
  if (!frm?.components) return;

  for (const id in frm.components) {
    const comp = frm.components[id];
    const el = comp?.getDOMElement?.();
    if (!el || !(el instanceof Element)) continue;

    if (el.getAttribute(MARK_ATTR) !== id) el.setAttribute(MARK_ATTR, id);
    const type = comp._type || comp.constructor?.name || '';
    if (type && el.getAttribute(TYPE_ATTR) !== type) el.setAttribute(TYPE_ATTR, type);
  }
}

let markingTimer: number | null = null;

function setMarking(enabled: boolean): void {
  if (enabled && markingTimer === null) {
    syncComponents();
    // Nexacro keeps adding/removing components (popups, grid rows) with no
    // public hook to observe — a short poll is simpler and more reliable
    // here than trying to catch every internal render path.
    markingTimer = window.setInterval(syncComponents, 500);
  } else if (!enabled && markingTimer !== null) {
    window.clearInterval(markingTimer);
    markingTimer = null;
  }
}

function runComponentAction(
  componentId: string,
  action: string,
  value?: string,
): { ok: boolean; error?: string; value?: string } {
  const frm = getFrame();
  if (!frm) return { ok: false, error: 'window.nexacro is not available on this page' };

  const comp = frm.lookup(componentId);
  if (!comp) return { ok: false, error: `Nexacro component not found: ${componentId}` };

  try {
    switch (action) {
      case 'click':
        comp.click?.();
        comp.onclick?.();
        return { ok: true };
      case 'set_value':
        comp.set_value?.(value ?? '');
        comp.setFocus?.();
        comp.onchange?.();
        return { ok: true };
      case 'get_value':
        return { ok: true, value: String(comp.value ?? comp.get_value?.() ?? '') };
      default:
        return { ok: false, error: `Unknown nexacro action: ${action}` };
    }
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

document.addEventListener(MARKING_EVENT, ((event: CustomEvent) => {
  setMarking(!!event.detail?.enabled);
}) as EventListener);

document.addEventListener(REQUEST_EVENT, ((event: CustomEvent) => {
  const { requestId, componentId, action, value } = event.detail;
  const result = runComponentAction(componentId, action, value);
  document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, { detail: { requestId, ...result } }));
}) as EventListener);
