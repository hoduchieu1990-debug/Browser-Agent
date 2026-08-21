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
import { findNexacroComponent, nexacroSelector } from './utils/nexacro';

declare global {
  interface Window {
    __browserAgentAttached?: boolean;
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

function capture(action: RecordedActionPayload, el: Element): void {
  // screenshot steps already capture their own full image as the step's
  // actual output — a second, smaller copy of the same thing would be noise.
  const thumbnail = action.type !== 'screenshot' ? { rect: rectOf(el), dpr: window.devicePixelRatio || 1 } : {};

  chrome.runtime.sendMessage({
    type: 'RECORDED_ACTION',
    action,
    replacesLastClick: takeSupersededClick(el),
    ...thumbnail,
  } satisfies RuntimeMessage);
}

function recordTable(table: HTMLElement): void {
  capture(
    {
      type: 'extractTable',
      ...locate(table),
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

function setRecording(value: boolean, highlightElements: boolean): void {
  if (value && !recorder) {
    tableCount = 0;
    textCount = 0;
    imageCount = 0;
    batchExtractCount = 0;
    lastPageClick = null;
    document.addEventListener('click', notePageClick, true);
    recorder = attachListeners((action, el) => {
      chrome.runtime.sendMessage({
        type: 'RECORDED_ACTION',
        action,
        rect: rectOf(el),
        dpr: window.devicePixelRatio || 1,
      } satisfies RuntimeMessage);
    });
    detachBadge = attachExtractBadge({
      onAddTable: recordTable,
      onAddText: recordText,
      onAddImage: recordImage,
      onAddInput: recordInput,
      onAddBatch: recordBatch,
      onStop: () => chrome.runtime.sendMessage({ type: 'STOP_RECORDING' } satisfies RuntimeMessage),
      // two outlines on screen at once is noise; the badge's is the precise one
      onTargetChange: (hasTarget) => highlighter?.setPaused(hasTarget),
    });
  } else if (!value && recorder) {
    document.removeEventListener('click', notePageClick, true);
    lastPageClick = null;
    recorder.detach();
    recorder = null;
    detachBadge?.();
    detachBadge = null;
    clearToasts();
  }

  if (value && highlightElements && !highlighter) {
    highlighter = attachHighlighter();
  } else if ((!value || !highlightElements) && highlighter) {
    highlighter.detach();
    highlighter = null;
  }
}

// The manifest injects this on page load and the background re-injects it when
// recording starts; only the first run may register listeners.
if (!window.__browserAgentAttached) {
  window.__browserAgentAttached = true;

  chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
    if (message.type === 'SET_RECORDING') setRecording(message.value, message.highlightElements);
    if (message.type === 'SHOW_TOAST') showToast(message.step, describeAction(message.action));

    if (message.type === 'REPLAY_STEP') {
      executeStep(message.action).then(
        (result) => sendResponse(result),
        (error: Error) => sendResponse({ error: error.message }),
      );
      return true; // async sendResponse
    }
  });

  chrome.runtime.sendMessage({ type: 'GET_STATE' } satisfies RuntimeMessage, (state: RecorderState) => {
    if (state?.recording) setRecording(true, state.highlightElements);
  });
}
