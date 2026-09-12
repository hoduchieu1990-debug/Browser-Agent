import type { RuntimeMessage, RecorderState, BatchInputType, RecordedActionPayload, ThumbnailRect } from './types';
import { isExtensionUi } from './utils/ui-marker';
import { attachListeners, type RecorderHandle } from './utils/action-recorder';
import { attachHighlighter, type HighlighterHandle } from './utils/highlighter';
import { attachExtractBadge, type BatchKind } from './utils/extract-badge';
import { extractTableHeaders } from './utils/table-utils';
import { generateSelectorCandidates } from './utils/selector-utils';
import { showToast, clearToasts } from './utils/toast';
import { describeAction } from './utils/action-display';
import { executeStep } from './utils/replay-executor';
import { findNexacroComponent, findNexacroGrid, nexacroSelector } from './utils/nexacro';
import { detectFramework } from './utils/framework';

declare global {
  interface Window {
    __browserAgentAttached?: boolean;
    __browserAgentListener?: (message: RuntimeMessage, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => boolean | void;
    // The recorder/highlighter/badge from whichever generation of this
    // script most recently turned recording on — see setRecording's own
    // comment for why a stale generation's copies can't just be left alone.
    __browserAgentTeardown?: () => void;
  }
}

let recorder: RecorderHandle | null = null;
let highlighter: HighlighterHandle | null = null;
let detachBadge: (() => void) | null = null;
let tableCount = 0;
let textCount = 0;
let imageCount = 0;
let batchExtractCount = 0;

function locate(el: Element): { selector: string; selectorFallbacks?: string[] } {
  const nexacro = findNexacroComponent(el);
  if (nexacro) return { selector: nexacroSelector(nexacro.id) };

  const [selector, ...rest] = generateSelectorCandidates(el);
  return rest.length ? { selector, selectorFallbacks: rest } : { selector };
}

// A Nexacro Grid is read through its bound dataset, never off the DOM, so a
// table step has to name the Grid component itself even when the user
// pointed at a cell inside it — the one place resolving up into the grid is
// what's wanted, rather than the exact node under the cursor.
function locateTable(el: Element): { selector: string; selectorFallbacks?: string[] } {
  const grid = findNexacroGrid(el);
  return grid ? { selector: nexacroSelector(grid.id) } : locate(el);
}

// Clicking something to aim at it and then pressing Add is one intention, not
// two: the click was how the user pointed, and Add is what they meant. Left
// alone it lands in the recording as its own step, so Add reports whether it
// supersedes one and the background drops it.
const AIM_CLICK_WINDOW_MS = 10000;
let lastPageClick: { el: Element; at: number } | null = null;

function takeSupersededClick(captured: Element): boolean {
  const aim = lastPageClick;
  lastPageClick = null;
  if (!aim || Date.now() - aim.at > AIM_CLICK_WINDOW_MS) return false;
  return captured === aim.el || captured.contains(aim.el);
}

function notePageClick(event: MouseEvent): void {
  const target = event.target as Element | null;
  if (target && !isExtensionUi(target)) lastPageClick = { el: target, at: Date.now() };
}

// getBoundingClientRect is already viewport-relative, matching what
// captureVisibleTab photographs — cheap and synchronous, so grabbing it here
// adds nothing perceptible to the click that is being recorded. The actual
// screenshot happens later, in the background, off this critical path.
function rectOf(el: Element): ThumbnailRect {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

// Left off entirely for ordinary HTML: every step on a normal page carrying
// framework:'html' would be noise in the exported workflow.
function tagFramework(action: RecordedActionPayload, el: Element): RecordedActionPayload {
  const framework = detectFramework(el);
  return framework ? { ...action, framework } : action;
}

// A reload while this generation was already attached kills chrome.runtime
// out from under it with no event to react to — the first sign is always
// whatever call happens to reach for it next throwing. Called from every
// spot that's about to reach for chrome.runtime from a listener that might
// belong to a now-dead generation, so tearing it down happens right away
// instead of only ever relying on some FUTURE generation's own recovery
// (see setRecording's own comment) — a page nobody interacts with again
// after the reload still ends up clean instead of quietly dead.
// __browserAgentAttached is cleared too, not just the local recorder/badge/
// highlighter: hasListener() reflects whether THIS FUNCTION OBJECT is still
// registered, which Chrome may still say yes to even once its closure can no
// longer reach chrome.runtime — clearing the flag directly means the next
// fresh injection re-registers unconditionally rather than depending on
// that check alone.
function selfDetachIfDead(): boolean {
  if (chrome.runtime?.id) return false;
  window.__browserAgentAttached = false;
  setRecording(false, false);
  return true;
}

function capture(action: RecordedActionPayload, el: Element): void {
  if (selfDetachIfDead()) return;

  // screenshot steps already capture their own full image as the step's
  // actual output — a second, smaller copy of the same thing would be noise.
  const thumbnail = action.type !== 'screenshot' ? { rect: rectOf(el), dpr: window.devicePixelRatio || 1 } : {};

  chrome.runtime.sendMessage({
    type: 'RECORDED_ACTION',
    action: tagFramework(action, el),
    replacesLastClick: takeSupersededClick(el),
    ...thumbnail,
  } satisfies RuntimeMessage);
}

function recordTable(table: HTMLElement): void {
  capture(
    {
      type: 'extractTable',
      ...locateTable(table),
      headers: extractTableHeaders(table),
      output: `table${++tableCount}`,
    },
    table,
  );
}

function recordText(el: HTMLElement): void {
  capture({ type: 'extractText', ...locate(el), output: `text${++textCount}` }, el);
}

function recordImage(el: HTMLElement): void {
  const name = `image${++imageCount}`;
  capture({ type: 'screenshot', ...locate(el), filename: `${name}.png`, output: name }, el);
}

// A one-shot "type this value into this field" step, configured afterward in
// the popup rather than by actually typing it on the page during recording.
function recordInput(el: HTMLElement): void {
  capture({ type: 'input', ...locate(el), value: '' }, el);
}

function recordHover(el: HTMLElement): void {
  capture({ type: 'hover', ...locate(el) }, el);
}

function inferBatchInputType(el: HTMLElement): BatchInputType {
  if (el instanceof HTMLSelectElement) return 'select';
  if (el instanceof HTMLInputElement && el.type === 'file') return 'fileUpload';
  return 'text';
}

// The Column/Extract Type/etc. fields that make a batch node runnable aren't
// picked here — there's no page-level config dialog — the user fills them in
// afterward in the popup's Record tab, which auto-expands the newest node.
function recordBatch(el: HTMLElement, kind: BatchKind): void {
  const located = locate(el);
  const action =
    kind === 'input'
      ? { type: 'batchInput' as const, ...located, inputType: inferBatchInputType(el), column: '', replaceMode: 'replace' as const }
      : kind === 'click'
        ? { type: 'batchClick' as const, ...located }
        : kind === 'search'
          ? { type: 'batchSearch' as const, ...located, waitCondition: { type: 'elementAppears' as const, timeout: 30000 } }
          : { type: 'batchExtract' as const, ...located, extractType: 'text' as const, output: `result${++batchExtractCount}` };

  capture(action, el);
}

// Reloading the extension while a tab was already recording leaves that
// generation's recorder/highlighter/badge permanently attached: their
// document/window listeners are plain DOM registrations, invisible to and
// outliving the dead extension connection they were built with (nothing
// ever calls their own detach() — the old script isn't torn down, just cut
// off). A fresh injection's setRecording(true, ...) used to skip past that
// silently since ITS OWN `recorder` starts out null regardless of what some
// earlier generation is still doing — meaning the page could end up with
// two full sets of listeners at once, the old one still firing on every
// hover/right-click but calling into a chrome.runtime that no longer exists
// ("Cannot read properties of undefined (reading 'sendMessage')"), while
// its own badge silently updates a copy of the UI already removed from the
// document. window.__browserAgentTeardown carries a reference to whichever
// generation last turned recording on, so a fresh one can find and tear
// down a stale leftover before adding its own.
function setRecording(value: boolean, highlightElements: boolean): void {
  if (value && !recorder) {
    window.__browserAgentTeardown?.();

    tableCount = 0;
    textCount = 0;
    imageCount = 0;
    batchExtractCount = 0;
    lastPageClick = null;
    document.addEventListener('click', notePageClick, true);
    recorder = attachListeners((action, el) => {
      if (selfDetachIfDead()) return;
      chrome.runtime.sendMessage({
        type: 'RECORDED_ACTION',
        action: tagFramework(action, el),
        rect: rectOf(el),
        dpr: window.devicePixelRatio || 1,
      } satisfies RuntimeMessage);
    });
    detachBadge = attachExtractBadge({
      onAddTable: recordTable,
      onAddText: recordText,
      onAddImage: recordImage,
      onAddInput: recordInput,
      onAddHover: recordHover,
      onAddBatch: recordBatch,
      // two outlines on screen at once is noise; the menu's is the precise one
      onTargetChange: (hasTarget) => highlighter?.setPaused(hasTarget),
    });
    window.__browserAgentTeardown = () => setRecording(false, false);
  } else if (!value && recorder) {
    document.removeEventListener('click', notePageClick, true);
    lastPageClick = null;
    recorder.detach();
    recorder = null;
    detachBadge?.();
    detachBadge = null;
    clearToasts();
    window.__browserAgentTeardown = undefined;
  }

  if (value && highlightElements && !highlighter) {
    highlighter = attachHighlighter();
  } else if ((!value || !highlightElements) && highlighter) {
    highlighter.detach();
    highlighter = null;
  }
}

// The manifest injects this on page load and the background re-injects it
// whenever recording starts or a step is about to replay — normally that's
// just a same-generation re-injection into an already-attached page, which
// must NOT register a second listener (every message would then fire
// twice). But __browserAgentAttached is a plain flag on `window`, which
// survives page-lifetime events that DON'T survive an extension reload: the
// listener a pre-reload injection registered dies with that reload (Chrome
// invalidates it), yet the flag it left behind still reads true, so a
// freshly re-injected copy would see "already attached" and skip
// registering its own — working — listener, leaving the page with no way
// to hear SET_RECORDING at all until a real page reload wipes the flag.
// hasListener asks the CURRENT (guaranteed-live, just-injected) chrome.runtime
// binding whether it actually still holds the stored function reference —
// true only when this is genuinely the same still-live generation.
const staleAttachment =
  window.__browserAgentAttached &&
  (!window.__browserAgentListener || !chrome.runtime.onMessage.hasListener(window.__browserAgentListener));

if (!window.__browserAgentAttached || staleAttachment) {
  window.__browserAgentAttached = true;

  const onMessage = (message: RuntimeMessage, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
    if (message.type === 'SET_RECORDING') setRecording(message.value, message.highlightElements);
    if (message.type === 'SHOW_TOAST') showToast(message.step, describeAction(message.action));

    if (message.type === 'REPLAY_STEP') {
      executeStep(message.action).then(
        (result) => sendResponse(result),
        (error: Error) => sendResponse({ error: error.message }),
      );
      return true; // async sendResponse
    }
  };
  window.__browserAgentListener = onMessage;
  chrome.runtime.onMessage.addListener(onMessage);

  chrome.runtime.sendMessage({ type: 'GET_STATE' } satisfies RuntimeMessage, (state: RecorderState) => {
    if (state?.recording) setRecording(true, state.highlightElements);
  });
}
