import type { RuntimeMessage, RecorderState } from './types';
import { attachListeners, type RecorderHandle } from './utils/action-recorder';
import { attachHighlighter } from './utils/highlighter';
import { attachExtractBadge } from './utils/extract-badge';
import { extractTableHeaders } from './utils/table-utils';
import { generateSelector } from './utils/selector-utils';
import { showToast, clearToasts } from './utils/toast';
import { describeAction } from './utils/action-display';
import { executeStep } from './utils/replay-executor';
import { togglePanel, setPanelVisible } from './utils/panel-host';

declare global {
  interface Window {
    __browserAgentAttached?: boolean;
  }
}

let recorder: RecorderHandle | null = null;
let detachHighlighter: (() => void) | null = null;
let detachBadge: (() => void) | null = null;
let tableCount = 0;
let textCount = 0;
let imageCount = 0;

function recordTable(table: HTMLTableElement): void {
  chrome.runtime.sendMessage({
    type: 'RECORDED_ACTION',
    action: {
      type: 'extractTable',
      selector: generateSelector(table),
      headers: extractTableHeaders(table),
      output: `table${++tableCount}`,
    },
  } satisfies RuntimeMessage);
}

function recordText(el: HTMLElement): void {
  chrome.runtime.sendMessage({
    type: 'RECORDED_ACTION',
    action: { type: 'extractText', selector: generateSelector(el), output: `text${++textCount}` },
  } satisfies RuntimeMessage);
}

function recordImage(el: HTMLElement): void {
  const name = `image${++imageCount}`;
  chrome.runtime.sendMessage({
    type: 'RECORDED_ACTION',
    action: { type: 'screenshot', selector: generateSelector(el), filename: `${name}.png`, output: name },
  } satisfies RuntimeMessage);
}

function setRecording(value: boolean, highlightElements: boolean): void {
  if (value && !recorder) {
    tableCount = 0;
    textCount = 0;
    imageCount = 0;
    recorder = attachListeners((action) => {
      chrome.runtime.sendMessage({ type: 'RECORDED_ACTION', action } satisfies RuntimeMessage);
    });
    detachBadge = attachExtractBadge({
      onAddTable: recordTable,
      onAddText: recordText,
      onAddImage: recordImage,
    });
  } else if (!value && recorder) {
    recorder.detach();
    recorder = null;
    detachBadge?.();
    detachBadge = null;
    clearToasts();
  }

  if (value && highlightElements && !detachHighlighter) {
    detachHighlighter = attachHighlighter();
  } else if ((!value || !highlightElements) && detachHighlighter) {
    detachHighlighter();
    detachHighlighter = null;
  }
}

// The manifest injects this on page load and the background re-injects it when
// recording starts; only the first run may register listeners.
if (!window.__browserAgentAttached) {
  window.__browserAgentAttached = true;

  chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
    if (message.type === 'SET_RECORDING') setRecording(message.value, message.highlightElements);
    if (message.type === 'SHOW_TOAST') showToast(message.step, describeAction(message.action));
    // this script runs in every frame; only the outermost one owns the panel
    if (message.type === 'TOGGLE_PANEL' && window.top === window) togglePanel();
    if (message.type === 'SHOW_PANEL' && window.top === window) setPanelVisible(true);

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
