import type {
  WorkflowAction,
  RuntimeMessage,
  RecorderSettings,
  ReplayState,
  ReplayStepLog,
  SavedRecording,
} from './types';
import { DEFAULT_SETTINGS } from './types';
import {
  saveSession,
  loadSession,
  clearSession,
  saveSettings,
  loadSettings,
  loadRecordings,
  addRecording,
  deleteRecording,
  saveReplayState,
  loadReplayState,
} from './utils/storage-manager';
import { captureElement, captureElementViaDebugger, type CaptureRect } from './utils/capture';

const STEP_SETTLE_MS = 300;
const NAVIGATION_TIMEOUT_MS = 30000;
const STALL_TIMEOUT_MS = 45000;

let recording = false;
let actions: WorkflowAction[] = [];
let stepCounter = 0;
let settings: RecorderSettings = DEFAULT_SETTINGS;
let replayState: ReplayState | null = null;
let replaying = false;
let recordingHost: string | null = null;

loadSession().then((saved) => {
  actions = saved;
  stepCounter = saved.length;
});
loadSettings().then((saved) => {
  settings = saved;
});

function log(...args: unknown[]): void {
  if (settings.verboseLogging) console.log('[browser-agent]', ...args);
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

// A page loaded before this extension was installed/reloaded has no content
// script, so tabs.sendMessage would fail. Injecting on demand makes Start work
// without asking the user to refresh first.
async function attachToActiveTab(highlightElements: boolean): Promise<string | null> {
  const tab = await getActiveTab();
  if (!tab?.id) return 'No active tab found.';

  // tab.url is unreadable without the "tabs" permission, so don't pre-screen the
  // URL — let the injection itself report why a page is off-limits.
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['content-script.js'],
    });
  } catch (error) {
    return `Cannot record this page: ${(error as Error).message}`;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: 'SET_RECORDING',
      value: true,
      highlightElements,
    } satisfies RuntimeMessage);
  } catch (error) {
    return `Page did not respond: ${(error as Error).message}`;
  }

  return null;
}

async function detachFromActiveTab(): Promise<void> {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  chrome.tabs
    .sendMessage(tab.id, { type: 'SET_RECORDING', value: false, highlightElements: false } satisfies RuntimeMessage)
    .catch(() => {}); // page may already be gone — nothing to turn off
}

function notifyActionsUpdated(): void {
  chrome.runtime.sendMessage({ type: 'ACTIONS_UPDATED', actions } satisfies RuntimeMessage).catch(() => {});
}

function pushAction(action: WorkflowAction, tabId?: number): void {
  actions.push(action);
  saveSession(actions);
  notifyActionsUpdated();

  if (settings.onPageConfirmation && tabId) {
    chrome.tabs
      .sendMessage(tabId, { type: 'SHOW_TOAST', step: actions.length, action } satisfies RuntimeMessage)
      .catch(() => {}); // page may not have a listener (e.g. this action came from an iframe navigation)
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function hostnameOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

function deriveRecordingName(recorded: WorkflowAction[]): string {
  const firstNavigate = recorded.find((action) => action.type === 'navigate');
  const fromNavigate = firstNavigate?.type === 'navigate' ? hostnameOf(firstNavigate.url) : null;
  // Recordings started on an already-open page have no navigate step, so fall
  // back to the host the content script reported.
  return fromNavigate ?? recordingHost ?? 'Recording';
}

// Every completed session is kept, so starting a new recording no longer
// destroys the previous one.
async function archiveCurrentRecording(): Promise<void> {
  if (actions.length === 0) return;

  const recording: SavedRecording = {
    id: `rec-${Date.now()}`,
    name: deriveRecordingName(actions),
    createdAt: new Date().toISOString(),
    actions,
  };

  const recordings = await addRecording(recording);
  chrome.runtime.sendMessage({ type: 'RECORDINGS_UPDATED', recordings } satisfies RuntimeMessage).catch(() => {});
}

function navigateAndWait(tabId: number, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.webNavigation.onCompleted.removeListener(onCompleted);
      reject(new Error(`Navigation to ${url} timed out`));
    }, NAVIGATION_TIMEOUT_MS);

    function onCompleted(details: chrome.webNavigation.WebNavigationFramedCallbackDetails) {
      if (details.tabId !== tabId || details.frameId !== 0) return;
      clearTimeout(timer);
      chrome.webNavigation.onCompleted.removeListener(onCompleted);
      resolve();
    }

    chrome.webNavigation.onCompleted.addListener(onCompleted);
    chrome.tabs.update(tabId, { url }).catch((error) => {
      clearTimeout(timer);
      chrome.webNavigation.onCompleted.removeListener(onCompleted);
      reject(error);
    });
  });
}

// A replayed click can navigate the page, which tears down the content script;
// re-injecting before every step keeps the next one from talking to a dead frame.
async function sendStep(tabId: number, action: WorkflowAction): Promise<any> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content-script.js'] });
  return chrome.tabs.sendMessage(tabId, { type: 'REPLAY_STEP', action } satisfies RuntimeMessage);
}

// MV3 can shut the service worker down mid-replay, leaving a state that says
// "running" forever. If nothing advanced for a while, report it as stalled
// instead of spinning in the popup with no explanation.
function markStalled(state: ReplayState | null): ReplayState | null {
  if (!state?.running || Date.now() - state.updatedAt < STALL_TIMEOUT_MS) return state;

  return {
    ...state,
    running: false,
    error: 'Replay stopped unexpectedly (the extension was suspended by the browser). Try again.',
    steps: state.steps.map((s) => (s.status === 'running' ? { ...s, status: 'failed', message: 'interrupted' } : s)),
  };
}

function actionTarget(action: WorkflowAction): string | undefined {
  if ('url' in action) return action.url;
  if ('selector' in action) return action.selector;
  return undefined;
}

// Publishes after every step: the popup is usually closed mid-replay (it dies
// when the page navigates), so storage — not the message — is what it reads.
async function publishReplayState(state: ReplayState): Promise<void> {
  replayState = state;
  await saveReplayState(state);
  chrome.runtime.sendMessage({ type: 'REPLAY_UPDATED', state } satisfies RuntimeMessage).catch(() => {});
}

// Runs the workflow where the user never sees it. A minimized window rather
// than an inactive tab, because captureVisibleTab only ever photographs the
// active tab of a window — from an inactive tab it fails outright, while a
// minimized window still renders and returns a real frame.
async function openHiddenWindow(): Promise<chrome.windows.Window> {
  return chrome.windows.create({ url: 'about:blank', focused: false, state: 'minimized' });
}

// Two ways to photograph an element, each with a blind spot: captureVisibleTab
// dies on a window that is not on screen ("image readback failed"), while the
// devtools route puts a "being debugged" bar on the window it attaches to.
// Prefer whichever suits the mode and fall back to the other rather than
// losing the screenshot.
async function captureForStep(
  request: { rect: CaptureRect; pageRect: CaptureRect; dpr: number },
  tabId: number,
  windowId: number,
  inBackground: boolean,
): Promise<string> {
  const viaTab = () => captureElement(windowId, request.rect, request.dpr);
  const viaDebugger = () => captureElementViaDebugger(tabId, request.pageRect);
  const attempts = inBackground ? [viaDebugger, viaTab] : [viaTab, viaDebugger];

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function runReplay(inBackground: boolean): Promise<void> {
  const startedAt = Date.now();
  const state: ReplayState = {
    running: true,
    total: actions.length,
    steps: [],
    variables: {},
    startedAt,
    updatedAt: startedAt,
  };

  const finish = (error?: string) =>
    publishReplayState({ ...state, running: false, error, updatedAt: Date.now() });

  if (inBackground && !actions.some((a) => a.type === 'navigate')) {
    await finish('This recording has no starting URL, so it cannot run in the background. Re-record it.');
    return;
  }

  const hiddenWindow = inBackground ? await openHiddenWindow() : null;
  const tab = hiddenWindow ? hiddenWindow.tabs?.[0] : await getActiveTab();
  if (!tab?.id) {
    await finish(inBackground ? 'Could not open a background window.' : 'No active tab found.');
    return;
  }
  const tabId = tab.id;
  const windowId = hiddenWindow?.id ?? tab.windowId;

  const closeHiddenWindow = async () => {
    if (hiddenWindow?.id !== undefined) await chrome.windows.remove(hiddenWindow.id).catch(() => {});
  };

  await publishReplayState(state);

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const stepStart = Date.now();

    state.steps = [
      ...state.steps,
      { index: i + 1, type: action.type, target: actionTarget(action), status: 'running' },
    ];
    state.updatedAt = Date.now();
    await publishReplayState(state);

    const settle = (patch: Partial<ReplayStepLog>) => {
      state.steps = state.steps.map((s) =>
        s.index === i + 1 ? { ...s, ...patch, durationMs: Date.now() - stepStart } : s,
      );
      state.updatedAt = Date.now();
    };

    try {
      if (action.type === 'navigate') {
        await navigateAndWait(tabId, action.url);
        settle({ status: 'done' });
      } else {
        const result = await sendStep(tabId, action);
        if (result?.error) throw new Error(result.error);

        if (result?.capture) {
          const dataUrl = await captureForStep(result.capture, tabId, windowId, inBackground);
          state.variables = { ...state.variables, [result.capture.key]: dataUrl };
          settle({ status: 'done', message: `→ ${result.capture.key}` });
        } else if (result?.skipped) {
          settle({ status: 'skipped', message: result.skipped });
        } else if (result?.output) {
          state.variables = { ...state.variables, [result.output.key]: result.output.value };
          settle({ status: 'done', message: `→ ${result.output.key}` });
        } else {
          settle({ status: 'done' });
        }
      }

      await publishReplayState(state);
      await delay(STEP_SETTLE_MS);
    } catch (error) {
      const message = (error as Error).message;
      settle({ status: 'failed', message });
      await closeHiddenWindow();
      await finish(`Step ${i + 1} (${action.type}): ${message}`);
      return;
    }
  }

  await closeHiddenWindow();
  await finish();
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  log('message', message.type);

  switch (message.type) {
    case 'START_RECORDING':
      recording = true;
      actions = [];
      stepCounter = 0;
      recordingHost = null;
      clearSession();
      attachToActiveTab(settings.highlightElements).then((error) => {
        if (error) {
          recording = false;
          log('attach failed', error);
        }
        sendResponse({ recording, actions, error });
      });
      return true; // async sendResponse

    case 'STOP_RECORDING':
      recording = false;
      detachFromActiveTab();
      archiveCurrentRecording();
      sendResponse({ recording, actions });
      return;

    case 'GET_RECORDINGS':
      loadRecordings().then((recordings) => sendResponse(recordings));
      return true; // async sendResponse

    case 'LOAD_RECORDING':
      loadRecordings().then((recordings) => {
        const found = recordings.find((r) => r.id === message.id);
        if (found) {
          actions = [...found.actions];
          stepCounter = actions.length;
          replayState = null; // results from the previous recording no longer apply
          saveSession(actions);
          notifyActionsUpdated();
        }
        sendResponse({ recording, actions });
      });
      return true;

    case 'DELETE_RECORDING':
      deleteRecording(message.id).then((recordings) => sendResponse(recordings));
      return true;

    case 'RESET':
      actions = [];
      stepCounter = 0;
      clearSession();
      notifyActionsUpdated();
      sendResponse({ recording, actions });
      return;

    case 'GET_STATE':
      sendResponse({ recording, actions, highlightElements: settings.highlightElements });
      return;

    case 'REMOVE_ACTION':
      actions.splice(message.index, 1);
      saveSession(actions);
      notifyActionsUpdated();
      return;

    case 'GET_SETTINGS':
      sendResponse(settings);
      return;

    case 'REPLAY_START':
      if (replaying) return;
      recording = false; // otherwise the recorder would capture the replay's own clicks
      detachFromActiveTab();
      replaying = true;
      runReplay(message.background).finally(() => {
        replaying = false;
      });
      return;

    case 'GET_REPLAY_STATE':
      // storage, not memory: the worker may have been restarted since the replay
      loadReplayState().then((stored) => sendResponse(markStalled(stored ?? replayState)));
      return true; // async sendResponse

    case 'SET_SETTINGS':
      settings = message.settings;
      saveSettings(settings);
      if (recording) attachToActiveTab(settings.highlightElements);
      sendResponse(settings);
      return;

    case 'RECORDED_ACTION': {
      if (!recording) return;
      const tabId = sender.tab?.id;
      recordingHost ??= hostnameOf(sender.url); // sender.url needs no "tabs" permission

      const action = { ...message.action, id: `step-${++stepCounter}` } as WorkflowAction;

      // Recording usually starts on a page that is already open, so nothing
      // captured the starting URL. Without it the workflow cannot run anywhere
      // except the tab it was recorded in — no headless CLI run, no re-run later.
      if (actions.length === 0 && action.type !== 'navigate' && sender.url) {
        pushAction({ id: `step-${stepCounter}-start`, type: 'navigate', url: sender.url }, tabId);
      }

      pushAction(action, tabId);

      if (settings.captureScreenshots && action.type !== 'navigate') {
        pushAction(
          { id: `step-${++stepCounter}`, type: 'screenshot', filename: `screenshot-${stepCounter}.png` },
          tabId,
        );
      }
      return;
    }
  }
});

// Re-attach after the page navigates — the fresh document has no listeners yet.
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (!recording || details.frameId !== 0) return;
  pushAction({ id: `step-${++stepCounter}`, type: 'navigate', url: details.url }, details.tabId);
});

chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (!recording || details.frameId !== 0) return;
  const tab = await getActiveTab();
  if (tab?.id === details.tabId) await attachToActiveTab(settings.highlightElements);
});

// The panel lives in the page, so opening it means injecting into the page —
// clicking the toolbar icon and the keyboard shortcut both land here.
async function togglePanelOnActiveTab(): Promise<void> {
  const tab = await getActiveTab();
  if (!tab?.id) return;

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-script.js'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' } satisfies RuntimeMessage);
  } catch (error) {
    log('cannot open panel here', (error as Error).message);
  }
}

chrome.action.onClicked.addListener(() => {
  togglePanelOnActiveTab();
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-panel') togglePanelOnActiveTab();
});

// A recorded page reload wipes the panel; put it back so the user keeps the
// controls in front of them while teaching.
chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (!recording || details.frameId !== 0) return;
  chrome.tabs.sendMessage(details.tabId, { type: 'SHOW_PANEL' } satisfies RuntimeMessage).catch(() => {});
});
