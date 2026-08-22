import type {
  WorkflowAction,
  RuntimeMessage,
  RecorderSettings,
  ReplayState,
  ReplayStepLog,
  SavedRecording,
  BatchDataset,
  BatchReplayState,
  BatchRunRow,
  DataRow,
  ThumbnailRect,
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
  clearReplayState,
  saveBatchDataset,
  loadBatchDataset,
  saveBatchState,
  loadBatchState,
  saveThumbnail,
  deleteThumbnail,
  clearThumbnails,
  loadThumbnails,
} from './utils/storage-manager';
import { captureElement, captureElementViaDebugger, captureThumbnail, type CaptureRect } from './utils/capture';
import { setFileInputFilesViaDebugger } from './utils/file-input';

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
let batchDataset: BatchDataset | null = null;
let batchState: BatchReplayState | null = null;
let batchRunning = false;
let batchCancelled = false;
let thumbnails: Record<string, string> = {};

loadSession().then((saved) => {
  actions = saved;
  stepCounter = saved.length;
});
loadThumbnails().then((saved) => {
  thumbnails = saved;
});
loadSettings().then((saved) => {
  settings = saved;
  // The panel's enabled/behaviour flags live in the browser, not our storage,
  // and reset when the extension reloads — restate them from the saved choice.
  applyPinSide(settings.pinSide);
});
loadBatchDataset().then((saved) => {
  batchDataset = saved;
});

function log(...args: unknown[]): void {
  if (settings.verboseLogging) console.log('[browser-agent]', ...args);
}

// Which browsing window the user was last actually looking at. The popup
// window Stop reopens takes over "last focused" while offering no site to
// record, and with several windows open there is otherwise no way to tell
// which one they came from — chrome.windows.getAll() is not focus-ordered.
let lastBrowsingWindowId: number | null = null;

chrome.storage.session.get('lastBrowsingWindowId').then((stored) => {
  lastBrowsingWindowId ??= (stored.lastBrowsingWindowId as number | undefined) ?? null;
});

function rememberBrowsingWindow(windowId: number): void {
  lastBrowsingWindowId = windowId;
  // MV3 stops the worker whenever it feels like it; without this the memory
  // of which window to record dies with it.
  chrome.storage.session.set({ lastBrowsingWindowId: windowId }).catch(() => {});
}

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const win = await chrome.windows.get(windowId).catch(() => null);
  if (win?.type === 'normal') rememberBrowsingWindow(windowId);
});

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const focused = await chrome.windows.getLastFocused().catch(() => null);
  if (focused?.type === 'normal' && focused.id !== undefined) {
    const [tab] = await chrome.tabs.query({ active: true, windowId: focused.id });
    if (tab) {
      rememberBrowsingWindow(focused.id);
      return tab;
    }
  }

  if (lastBrowsingWindowId !== null) {
    const [remembered] = await chrome.tabs.query({ active: true, windowId: lastBrowsingWindowId });
    if (remembered) return remembered;
  }

  const [fallback] = await chrome.tabs.query({ active: true, windowType: 'normal' });
  return fallback;
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

// Every capture names the variable it fills, and those names have to stay
// distinct across the whole recording: replay collects them into one object,
// so a repeat silently overwrites the earlier value. The page-side counters
// cannot manage that alone — a navigation reloads the content script and
// restarts them at 1 — so the last word on naming belongs here, where the
// session actually lives.
function withUniqueOutput(action: WorkflowAction): WorkflowAction {
  const desired = 'output' in action ? action.output : undefined;
  if (!desired) return action;

  const taken = new Set(actions.map((a) => ('output' in a ? a.output : undefined)).filter(Boolean));
  if (!taken.has(desired)) return action;

  const base = desired.replace(/\d+$/, '') || 'value';
  let n = 2;
  while (taken.has(`${base}${n}`)) n++;
  const output = `${base}${n}`;

  // a screenshot's file is named after its variable; renaming one renames both
  const renamed = { ...action, output } as WorkflowAction;
  return action.type === 'screenshot' && action.filename
    ? ({ ...renamed, filename: `${output}.png` } as WorkflowAction)
    : renamed;
}

// Recording can be stopped from the page's own badge, with the extension's
// window sitting open beside it — without this it would go on showing a
// recording that has already finished.
function notifyRecordingState(): void {
  chrome.runtime.sendMessage({ type: 'RECORDING_UPDATED', recording } satisfies RuntimeMessage).catch(() => {});
}

function notifyActionsUpdated(): void {
  chrome.runtime.sendMessage({ type: 'ACTIONS_UPDATED', actions } satisfies RuntimeMessage).catch(() => {});
}

// Preview's Steps/Result Data belong to whichever recording produced them —
// once the action list changes, that run no longer describes what Replay
// would do, so it must not keep showing as if it still did.
function invalidateReplayState(): void {
  replayState = null;
  clearReplayState();
}

// Fire-and-forget, on purpose: the click that triggered this has already
// been recorded and the popup already notified by the time this runs, so
// nothing about it can make recording feel slower. A failed capture (rate
// limit, tab mid-navigation, ...) just means that one step has no preview —
// not worth surfacing as an error.
function captureThumbnailFor(actionId: string, rect: ThumbnailRect, dpr: number, tabId: number): void {
  chrome.tabs
    .get(tabId)
    .then((tab) => {
      if (tab.windowId === undefined) return null;
      return captureThumbnail(tab.windowId, rect, dpr);
    })
    .then((dataUrl) => {
      if (!dataUrl) return;
      thumbnails[actionId] = dataUrl;
      saveThumbnail(actionId, dataUrl);
      chrome.runtime.sendMessage({ type: 'THUMBNAIL_READY', actionId, dataUrl } satisfies RuntimeMessage).catch(() => {});
    })
    .catch(() => {});
}

function pushAction(action: WorkflowAction, tabId?: number): void {
  invalidateReplayState();
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
    // Going somewhere that differs only by #fragment never reloads the page,
    // so onCompleted alone would sit there until it timed out. The same goes
    // for a site that answers the change with history.pushState.
    const events = [
      chrome.webNavigation.onCompleted,
      chrome.webNavigation.onReferenceFragmentUpdated,
      chrome.webNavigation.onHistoryStateUpdated,
    ];

    const stopListening = () => {
      clearTimeout(timer);
      for (const event of events) event.removeListener(onNavigated);
    };

    function onNavigated(details: chrome.webNavigation.WebNavigationFramedCallbackDetails) {
      if (details.tabId !== tabId || details.frameId !== 0) return;
      stopListening();
      resolve();
    }

    const timer = setTimeout(() => {
      stopListening();
      reject(new Error(`Navigation to ${url} timed out`));
    }, NAVIGATION_TIMEOUT_MS);

    for (const event of events) event.addListener(onNavigated);

    chrome.tabs.update(tabId, { url }).catch((error) => {
      stopListening();
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

let popupWindowId: number | null = null;

chrome.windows.onRemoved.addListener((id) => {
  if (id === popupWindowId) popupWindowId = null;
});

// Pin to Side hands the whole job to Chrome's side panel: it lives at the
// right edge and the page reflows beside it rather than being covered, which
// a popup window can never do.
async function applyPinSide(enabled: boolean): Promise<void> {
  // Kept available at all times, not switched with the setting: open() fails
  // outright on a panel that is not already enabled, and enabling it first
  // costs an await — which spends the user gesture open() also demands.
  // Availability alone shows nothing; what follows decides when it appears.
  await chrome.sidePanel.setOptions({ path: 'popup.html?side=1', enabled: true }).catch(() => {});
  // ?side above is how the page knows to lay itself out for a resizable panel
  // instead of a fixed-width popup — nothing else can tell the two apart.
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: enabled }).catch(() => {});
  // A declared popup wins over that behaviour, so the button would keep
  // opening the popup — which dismisses itself the moment the page is clicked,
  // exactly what pinning is meant to avoid. Clear it while pinned.
  await chrome.action.setPopup({ popup: enabled ? '' : 'popup.html' }).catch(() => {});
}

// Reopens the popup so Stop (clicked from the on-page badge, with nothing of
// ours on screen) has somewhere to land — the side panel when pinned, else a
// popup-type window so it still looks and behaves like the real thing.
async function openPopupWindow(windowId?: number): Promise<void> {
  if (settings.pinSide) {
    // open() demands a window or tab to attach to, and only accepts one from
    // a user gesture — the badge click that got us here counts.
    const target = windowId ?? (await getActiveTab())?.windowId;
    if (target !== undefined) {
      try {
        await chrome.sidePanel.open({ windowId: target });
        return;
      } catch (error) {
        log('side panel open failed', (error as Error).message);
      }
    }
  }

  if (popupWindowId !== null) {
    try {
      await chrome.windows.update(popupWindowId, { focused: true });
      return;
    } catch {
      popupWindowId = null; // the window was already closed
    }
  }

  const win = await chrome.windows.create({
    url: chrome.runtime.getURL('popup.html'),
    type: 'popup',
    width: 480,
    height: 640,
  });
  popupWindowId = win.id ?? null;
}

// Two ways to photograph an element, each with a blind spot: captureVisibleTab
// dies on a window that is not on screen ("image readback failed"), while the
// devtools route puts a "being debugged" bar on the window it attaches to.
// Prefer whichever suits the mode and fall back to the other rather than
// losing the screenshot.
async function captureForStep(
  request: { rect: CaptureRect; pageRect: CaptureRect; dpr: number; exceedsViewport?: boolean },
  tabId: number,
  windowId: number,
  inBackground: boolean,
): Promise<string> {
  const viaTab = () => captureElement(windowId, request.rect, request.dpr);
  const viaDebugger = () => captureElementViaDebugger(tabId, request.pageRect);
  // An element taller or wider than the screen cannot be cropped out of a
  // photo of the screen — whatever lies beyond the edge was never in it. The
  // devtools route renders past the viewport, so it is the only one that can.
  const preferDebugger = inBackground || request.exceedsViewport === true;
  const attempts = preferDebugger ? [viaDebugger, viaTab] : [viaTab, viaDebugger];

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
          // A screenshot is a nice-to-have; losing it must not throw away the
          // text and tables the run already collected.
          try {
            const dataUrl = await captureForStep(result.capture, tabId, windowId, inBackground);
            state.variables = { ...state.variables, [result.capture.key]: dataUrl };
            settle({ status: 'done', message: `→ ${result.capture.key}` });
          } catch (captureError) {
            settle({ status: 'skipped', message: `no image: ${(captureError as Error).message}` });
          }
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

// A Search node's own selector is already on the page the instant it's
// clicked — waiting on it would be a no-op. Absent an explicit wait target,
// the thing actually worth waiting for is whatever the workflow extracts next.
function defaultSearchWaitSelector(fromIndex: number): string | undefined {
  for (let i = fromIndex + 1; i < actions.length; i++) {
    const next = actions[i];
    if (next.type === 'batchExtract') return next.selector;
  }
  return undefined;
}

async function publishBatchState(state: BatchReplayState): Promise<void> {
  batchState = state;
  await saveBatchState(state);
  chrome.runtime.sendMessage({ type: 'BATCH_UPDATED', state } satisfies RuntimeMessage).catch(() => {});
}

// One action, one dataset row. Handles the one input type a content script
// cannot perform itself (fileUpload needs the debugger session); everything
// else goes through the normal REPLAY_STEP round trip.
async function runBatchStep(
  tabId: number,
  action: WorkflowAction,
  index: number,
  row: DataRow,
): Promise<{ output?: { key: string; value: unknown }; error?: string }> {
  if (action.type === 'navigate') {
    await navigateAndWait(tabId, action.url);
    return {};
  }

  if (action.type === 'batchInput' && action.inputType === 'fileUpload') {
    const filePath = row[action.column] ?? '';
    await setFileInputFilesViaDebugger(tabId, action.selector, action.selectorFallbacks, filePath);
    return {};
  }

  let toSend: WorkflowAction & { resolvedValue?: string } = action;
  if (action.type === 'batchInput') {
    toSend = { ...action, resolvedValue: row[action.column] ?? '' };
  } else if (action.type === 'batchSearch' && !action.waitCondition.selector) {
    const fallback = defaultSearchWaitSelector(index);
    if (fallback) toSend = { ...action, waitCondition: { ...action.waitCondition, selector: fallback } };
  }

  const result = await sendStep(tabId, toSend);
  if (result?.error) return { error: result.error };
  return { output: result?.output };
}

// Runs the recorded batch nodes once per dataset row, on the active tab —
// unlike runReplay this is meant to be watched, so there is no hidden window.
async function runBatchReplay(rows: DataRow[], stopOnError: boolean): Promise<void> {
  batchCancelled = false;
  const startedAt = Date.now();
  const state: BatchReplayState = { running: true, total: rows.length, rows: [], startedAt, updatedAt: startedAt };
  await publishBatchState(state);

  const tab = await getActiveTab();
  if (!tab?.id) {
    await publishBatchState({ ...state, running: false, error: 'No active tab found.', updatedAt: Date.now() });
    return;
  }
  const tabId = tab.id;

  for (const [i, row] of rows.entries()) {
    if (batchCancelled) break;

    let rowResult: BatchRunRow = { index: i + 1, input: row, output: {}, status: 'running' };
    state.rows = [...state.rows, rowResult];
    state.updatedAt = Date.now();
    await publishBatchState(state);

    try {
      const outputs: Record<string, string> = {};
      for (let a = 0; a < actions.length; a++) {
        if (batchCancelled) break;
        const stepResult = await runBatchStep(tabId, actions[a], a, row);
        if (stepResult.error) throw new Error(`${actions[a].type}: ${stepResult.error}`);
        if (stepResult.output) outputs[stepResult.output.key] = String(stepResult.output.value);
      }
      rowResult = { ...rowResult, output: outputs, status: 'success' };
    } catch (error) {
      rowResult = { ...rowResult, status: 'failed', error: (error as Error).message };
    }

    state.rows = state.rows.map((r) => (r.index === rowResult.index ? rowResult : r));
    state.updatedAt = Date.now();
    await publishBatchState(state);

    if (rowResult.status === 'failed' && stopOnError) break;
  }

  await publishBatchState({ ...state, running: false, updatedAt: Date.now() });
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
        notifyRecordingState();
        sendResponse({ recording, actions, error });
      });
      return true; // async sendResponse

    case 'STOP_RECORDING':
      recording = false;
      notifyRecordingState();
      detachFromActiveTab();
      archiveCurrentRecording();
      sendResponse({ recording, actions });
      // Only when Stop came from the on-page badge (sender.tab is set) is
      // there no popup on screen to show the result in. Reopening one
      // regardless would also steal lastFocusedWindow, which is what
      // attachToActiveTab reads — the next Start would then try to record
      // the popup itself.
      // (chrome.action.openPopup() looks like the fit, but it only honours a
      // gesture made directly on the action button; a click relayed from a
      // content script doesn't qualify and it fails silently.)
      if (sender.tab) {
        // The badge that sent this is proof of which window holds the site,
        // so the popup we are about to focus cannot muddle it.
        if (sender.tab.windowId !== undefined) rememberBrowsingWindow(sender.tab.windowId);
        openPopupWindow(sender.tab.windowId);
      }
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
          thumbnails = {};
          invalidateReplayState();
          saveSession(actions);
          clearThumbnails();
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
      thumbnails = {};
      clearSession();
      invalidateReplayState();
      notifyActionsUpdated();
      sendResponse({ recording, actions });
      return;

    case 'GET_STATE':
      sendResponse({ recording, actions, highlightElements: settings.highlightElements });
      return;

    case 'GET_THUMBNAILS':
      sendResponse(thumbnails);
      return;

    case 'REMOVE_ACTION': {
      const [removed] = actions.splice(message.index, 1);
      if (removed) {
        delete thumbnails[removed.id];
        deleteThumbnail(removed.id);
      }
      saveSession(actions);
      invalidateReplayState();
      notifyActionsUpdated();
      return;
    }

    case 'UPDATE_ACTION':
      actions[message.index] = { ...actions[message.index], ...message.patch } as WorkflowAction;
      saveSession(actions);
      invalidateReplayState();
      notifyActionsUpdated();
      return;

    case 'CLOSE_POPUP':
      // Pinned to the side, staying put is the whole point — and the id here
      // would be the browser window itself, so closing it would take the
      // page down with it.
      if (settings.pinSide) return;
      // window.close() only works for the one true action popup, not a
      // window opened via chrome.windows.create (like the one Stop reopens)
      // — chrome.windows.remove closes either kind, called from here where
      // it's actually allowed.
      chrome.windows.remove(message.windowId).catch(() => {});
      return;

    case 'GET_SETTINGS':
      sendResponse(settings);
      return;

    case 'REPLAY_START':
      if (replaying) return;
      recording = false; // otherwise the recorder would capture the replay's own clicks
      notifyRecordingState();
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

    case 'SET_SETTINGS': {
      settings = message.settings;
      saveSettings(settings);
      // Straight away, before any await: opening the panel needs the gesture
      // that produced this message, and awaiting first would spend it.
      applyPinSide(settings.pinSide);
      if (recording) attachToActiveTab(settings.highlightElements);
      sendResponse(settings);
      return;
    }

    case 'RECORDED_ACTION': {
      if (!recording) return;
      const tabId = sender.tab?.id;
      recordingHost ??= hostnameOf(sender.url); // sender.url needs no "tabs" permission

      // The click that aimed at this element was the same intention as the
      // Add that followed it, so it is not a step of its own.
      if (message.replacesLastClick && actions[actions.length - 1]?.type === 'click') {
        actions.pop();
      }

      const action = withUniqueOutput({ ...message.action, id: `step-${++stepCounter}` } as WorkflowAction);

      // Recording usually starts on a page that is already open, so nothing
      // captured the starting URL. Without it the workflow cannot run anywhere
      // except the tab it was recorded in — no headless CLI run, no re-run later.
      if (actions.length === 0 && action.type !== 'navigate' && sender.url) {
        pushAction({ id: `step-${stepCounter}-start`, type: 'navigate', url: sender.url }, tabId);
      }

      pushAction(action, tabId);

      if (message.rect && tabId !== undefined) {
        captureThumbnailFor(action.id, message.rect, message.dpr ?? 1, tabId);
      }

      if (settings.captureScreenshots && action.type !== 'navigate') {
        pushAction(
          { id: `step-${++stepCounter}`, type: 'screenshot', filename: `screenshot-${stepCounter}.png` },
          tabId,
        );
      }
      return;
    }

    case 'BATCH_SET_DATASET':
      batchDataset = { fileName: message.fileName, headers: message.headers, rows: message.rows };
      saveBatchDataset(batchDataset);
      sendResponse(batchDataset);
      return;

    case 'BATCH_GET_DATASET':
      sendResponse(batchDataset);
      return;

    case 'BATCH_TEST_ROW':
      if (batchRunning || !batchDataset?.rows.length) return;
      batchRunning = true;
      runBatchReplay([batchDataset.rows[0]], false).finally(() => {
        batchRunning = false;
      });
      return;

    case 'BATCH_RUN_ALL':
      if (batchRunning || !batchDataset?.rows.length) return;
      batchRunning = true;
      runBatchReplay(batchDataset.rows, message.stopOnError).finally(() => {
        batchRunning = false;
      });
      return;

    case 'BATCH_STOP':
      batchCancelled = true;
      return;

    case 'BATCH_GET_STATE':
      loadBatchState().then((stored) => sendResponse(stored ?? batchState));
      return true; // async sendResponse
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
