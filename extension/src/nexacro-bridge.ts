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
  _type_name?: string;
  value?: unknown;
  click?: () => void;
  onclick?: unknown;
  set_value?: (value: string) => void;
  get_value?: () => unknown;
  setFocus?: () => void;
  onchange?: unknown;
}

// A Nexacro-rendered DOM element's id is the component's full dotted
// object-model path (mainframe.WorkFrame.form...TextField00), sometimes
// with a trailing DOM-only rendering suffix ("box:simpleinput") that isn't a
// public property. Walking the path from window.nexacro.getApplication() and
// stopping at the last segment that actually resolves lands on the real
// component — verified against a live Nexacro N app (demo.tobesoft.com).
// (window.nexacro.getActiveFrame(), used here previously, does not exist on
// real Nexacro N — it silently made this whole bridge a no-op.)
function resolveComponent(id: string): NexacroComponent | null {
  const nexacro = (window as any).nexacro;
  const app = nexacro?.getApplication?.();
  if (!app) return null;

  const parts = id.replace(/:[^:.]*$/, '').split('.');
  let obj: any = app;
  for (let i = 0; i < parts.length; i++) {
    const next = obj?.[parts[i]];
    if (next === undefined) {
      // Only the very last segment is allowed to miss — that's the expected
      // DOM-rendering sub-part with no public property (e.g. "box" in
      // TextField00.box). A miss on any earlier segment means the component
      // tree isn't fully built yet (real, right after a fresh navigation —
      // observed on demo.tobesoft.com: the walk lands on a still-attaching
      // parent Form instead of the target TextField for about a second).
      // Returning null here (instead of that shallower parent) is what lets
      // the retry loop above keep polling instead of "succeeding" against
      // the wrong object.
      return i === parts.length - 1 ? obj : null;
    }
    obj = next;
  }
  return obj;
}

// Every rendered node under a Nexacro form gets a dotted id — wrapper divs
// (Form, ChildFrame, Panel) and internal rendering sub-parts (ButtonControl,
// EditControl, GridBandInfo, ...) included, confirmed by walking a live
// Nexacro N app end to end. Marking all of those would hand clicks on plain
// layout containers to the bridge instead of the component a user actually
// meant to interact with. This allowlist is the set of top-level interactive
// control types the reference docs describe (Button/Edit/Combo/CheckBox/
// Radio/DateField/Grid) plus the real type names observed live (TextField,
// MultiCombo) — the internal "*Control" and container types are excluded.
const INTERACTIVE_TYPES = new Set([
  'Button',
  'TextField',
  'Edit',
  'Combo',
  'MultiCombo',
  'CheckBox',
  'CheckBoxSet',
  'Radio',
  'RadioSet',
  'DateField',
  'Grid',
]);

function syncComponents(): void {
  if (!(window as any).nexacro?.getApplication) return;

  // Nexacro elements are the only ones on the page whose id is a real
  // multi-segment dotted path — scanning the (already-rendered) DOM for that
  // shape is far cheaper than recursively walking the component tree, and
  // finds exactly the same set.
  const candidates = Array.from(document.querySelectorAll('[id*="."]'));
  for (const el of candidates) {
    const id = el.id;
    if (el.getAttribute(MARK_ATTR) === id) continue;

    const comp = resolveComponent(id);
    if (!comp?._type_name || !INTERACTIVE_TYPES.has(comp._type_name)) continue;

    el.setAttribute(MARK_ATTR, id);
    el.setAttribute(TYPE_ATTR, comp._type_name);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// Replay's leading `navigate` step reloads the page, and a Nexacro app can
// take several seconds after that before getApplication()'s component tree
// is fully populated (observed ~8s on a real, heavy Nexacro N app) — an
// action run right after navigation can easily land before that, so this
// gives the app real time to finish booting instead of failing on the very
// first lookup.
const RESOLVE_TIMEOUT_MS = 15000;

async function runComponentAction(
  componentId: string,
  action: string,
  value?: string,
): Promise<{ ok: boolean; error?: string; value?: string }> {
  const deadline = Date.now() + RESOLVE_TIMEOUT_MS;
  let comp = resolveComponent(componentId);
  while (!comp && Date.now() < deadline) {
    await sleep(200);
    comp = resolveComponent(componentId);
  }
  if (!comp) return { ok: false, error: `Nexacro component not found: ${componentId}` };

  try {
    switch (action) {
      case 'click':
        comp.click?.();
        // A real component's onclick is a Nexacro EventHandler object, not a
        // plain function — comp.onclick?.() would still attempt the call
        // (optional chaining only guards null/undefined) and throw. click()
        // alone already runs the component's own click handling.
        if (typeof comp.onclick === 'function') comp.onclick();
        return { ok: true };
      case 'set_value':
        comp.set_value?.(value ?? '');
        comp.setFocus?.();
        if (typeof comp.onchange === 'function') comp.onchange();
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
  runComponentAction(componentId, action, value).then((result) => {
    document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, { detail: { requestId, ...result } }));
  });
}) as EventListener);
