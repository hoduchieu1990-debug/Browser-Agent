import type {
  WorkflowAction,
  ClickAction,
  RuntimeMessage,
  RecorderSettings,
  EmailSettings,
  ReplayState,
  ReplayStepLog,
  SavedRecording,
  BatchDataset,
  BatchReplayState,
  BatchRunRow,
  DataRow,
  ThumbnailRect,
} from './types';
import { DEFAULT_SETTINGS, DEFAULT_EMAIL_SETTINGS } from './types';
import {
  saveSession,
  loadSession,
  clearSession,
  saveSettings,
  loadSettings,
  saveEmailSettings,
  loadEmailSettings,
  loadRecordings,
  addRecording,
  deleteRecording,
  saveReplayState,
  loadReplayState,
  clearReplayState,
  saveReportPreviewState,
  loadReportPreviewState,
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
import { cdpClick } from './utils/cdp-click';
import { isNexacroSelector } from './utils/nexacro';

const STEP_SETTLE_MS = 300;
const NAVIGATION_TIMEOUT_MS = 30000;
const STALL_TIMEOUT_MS = 45000;

let recording = false;
let actions: WorkflowAction[] = [];
let stepCounter = 0;
let settings: RecorderSettings = DEFAULT_SETTINGS;
let emailSettings: EmailSettings = DEFAULT_EMAIL_SETTINGS;
let replayState: ReplayState | null = null;
let replaying = false;
// Keyed by recording id: more than one Report compose window can be open at
// once, each running a preview for a different job.
const reportPreviewStates: Record<string, ReplayState> = {};
const reportPreviewRunning = new Set<string>();
let recordingHost: string | null = null;
// The one tab actions are accepted from. Every open tab's content script
// enables its own click listeners whenever `recording` is true (the manifest
// injects it everywhere), so without this a click in an unrelated tab the
// user merely switched to — no navigation, so no chance to notice — would
// silently join the recording with no navigate step explaining how it got
// there, producing a workflow that can never find that element on replay.
let recordingTabId: number | null = null;
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
loadEmailSettings().then((saved) => {
  emailSettings = saved;
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

// chrome.tabs.sendMessage without a frameId only reaches the top frame — a
// real Nexacro app renders some of its internal "windows" as actual nested
// iframes (confirmed live: content-script.js runs in dozens of them, since
// executeScript above uses allFrames), so without this, Ctrl+Right-click
// silently does nothing anywhere inside one of those frames: the listeners
// were simply never attached there.
async function sendToAllFrames(tabId: number, message: RuntimeMessage): Promise<void> {
  const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => null);
  const frameIds = (frames ?? []).map((f) => f.frameId).filter((id) => id !== 0);
  await Promise.all(frameIds.map((frameId) => chrome.tabs.sendMessage(tabId, message, { frameId }).catch(() => {})));
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

  const message = { type: 'SET_RECORDING', value: true, highlightElements } satisfies RuntimeMessage;
  try {
    await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    return `Page did not respond: ${(error as Error).message}`;
  }
  await sendToAllFrames(tab.id, message);

  return null;
}

async function detachFromActiveTab(): Promise<void> {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  const message = { type: 'SET_RECORDING', value: false, highlightElements: false } satisfies RuntimeMessage;
  chrome.tabs.sendMessage(tab.id, message).catch(() => {}); // page may already be gone — nothing to turn off
  await sendToAllFrames(tab.id, message);
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
  Promise.all([chrome.tabs.get(tabId), chrome.tabs.getZoom(tabId).catch(() => 1)])
    .then(([tab, zoom]) => {
      if (tab.windowId === undefined) return null;
      return captureThumbnail(tab.windowId, rect, dpr, zoom);
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

// A trusted click (event.isTrusted === true) some frameworks require but a
// synthetic DOM MouseEvent can't produce. The content script only resolves
// the target and reports its point; the actual dispatch has to happen from
// here, since chrome.debugger is background/service-worker only. Returns
// null to tell the caller to fall back to a plain content-script click —
// either because there was no debugger session available (already owned by
// real DevTools, most commonly) or the dispatch itself failed — and the
// element's own StepResult (usually just an error) when point resolution
// itself is what failed, so the caller doesn't redundantly wait for the
// same missing element a second time.
async function tryCdpClick(tabId: number, action: ClickAction): Promise<any | null> {
  const pointResult = await chrome.tabs
    .sendMessage(tabId, { type: 'REPLAY_STEP', action: { ...action, cdpPointOnly: true } } satisfies RuntimeMessage)
    .catch(() => null);
  if (!pointResult) return null;
  if (pointResult.error) return pointResult;
  if (!pointResult.point) return null;
  const clicked = await cdpClick(tabId, pointResult.point);
  return clicked ? {} : null;
}

// A replayed click can navigate the page, which tears down the content script;
// re-injecting before every step keeps the next one from talking to a dead frame.
async function sendStep(tabId: number, action: WorkflowAction): Promise<any> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content-script.js'] });

  // Nexacro clicks already go through the component's own click() API (see
  // replay-executor.ts) — that's more reliable than a coordinate click for
  // them, so this only applies to everything else.
  if (action.type === 'click' && !isNexacroSelector(action.selector)) {
    const cdpResult = await tryCdpClick(tabId, action);
    if (cdpResult) return cdpResult;
  }

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

async function publishReportPreviewState(recordingId: string, state: ReplayState): Promise<void> {
  reportPreviewStates[recordingId] = state;
  await saveReportPreviewState(recordingId, state);
  chrome.runtime
    .sendMessage({ type: 'REPORT_PREVIEW_UPDATED', recordingId, state } satisfies RuntimeMessage)
    .catch(() => {});
}

// Runs the workflow where the user never sees it. A minimized window rather
// than an inactive tab, because captureVisibleTab only ever photographs the
// active tab of a window — from an inactive tab it fails outright, while a
// minimized window still renders and returns a real frame.
//
// An off-screen (not minimized) window was tried here to kill the brief
// visible flash chrome.windows.create({ state: 'minimized' }) causes — but
// testing turned up chrome.windows.create() sometimes never resolving at all
// with off-screen coordinates once enough other browser windows are already
// open (confirmed: the call hung past every timeout, with no error, no
// window, nothing — not just slow). A silent hang is a worse failure mode
// than a cosmetic flash, so this reverts to the proven-reliable minimized
// form until the flash can be fixed without that risk.
async function openHiddenWindow(): Promise<chrome.windows.Window> {
  return chrome.windows.create({ url: 'about:blank', focused: false, state: 'minimized' });
}

// A Report compose window's real-preview run needs the target site to
// actually finish loading its dynamic content (ad-heavy pages, lazy-loaded
// sections) the way it does for a normal foreground replay — a minimized
// window is enough for a one-off screenshot but not reliable for that, so
// this stays unminimized and is pushed off-screen instead, purely so the
// user never sees it pop up while their recording runs for real.
async function openReportPreviewWindow(): Promise<chrome.windows.Window> {
  return chrome.windows.create({ url: 'about:blank', focused: false, width: 1280, height: 900, left: -3000, top: 0 });
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

// A standalone window (not tracked/reused like openPopupWindow's popup) —
// the user can have more than one Report compose window open at once, and
// closing one shouldn't affect any other.
async function openReportWindow(recordingId: string): Promise<void> {
  await chrome.windows.create({
    url: chrome.runtime.getURL(`popup.html?report=${encodeURIComponent(recordingId)}`),
    type: 'popup',
    // Wide enough for the single-page layout (every section stacked, plus a
    // full-width report preview) to read comfortably without feeling cramped.
    width: 900,
    height: 860,
  });
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
  const zoom = await chrome.tabs.getZoom(tabId).catch(() => 1);
  const viaTab = () => captureElement(windowId, request.rect, request.dpr, zoom);
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

// Parameterized over both the actions to run and where progress is published
// so the main popup's replay and a Report compose window's own preview run
// (runReportPreview below) share this one implementation without either
// being able to overwrite the other's state.
async function runReplay(
  runActions: WorkflowAction[],
  inBackground: boolean,
  publish: (state: ReplayState) => Promise<void>,
  openWindow: () => Promise<chrome.windows.Window> = openHiddenWindow,
): Promise<void> {
  const startedAt = Date.now();
  const state: ReplayState = {
    running: true,
    total: runActions.length,
    steps: [],
    variables: {},
    startedAt,
    updatedAt: startedAt,
  };

  const finish = (error?: string) =>
    publish({ ...state, running: false, error, updatedAt: Date.now() });

  if (inBackground && !runActions.some((a) => a.type === 'navigate')) {
    await finish('This recording has no starting URL, so it cannot run in the background. Re-record it.');
    return;
  }

  const hiddenWindow = inBackground ? await openWindow() : null;
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

  await publish(state);

  for (let i = 0; i < runActions.length; i++) {
    const action = runActions[i];
    const stepStart = Date.now();

    state.steps = [
      ...state.steps,
      { index: i + 1, type: action.type, target: actionTarget(action), status: 'running' },
    ];
    state.updatedAt = Date.now();
    await publish(state);

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

      await publish(state);
      await delay(STEP_SETTLE_MS);
    } catch (error) {
      const message = (error as Error).message;

      // A step marked onError: 'skip'/'ignore' (e.g. dismissing a popup that
      // doesn't always appear) is expected to sometimes fail — that must not
      // abort a run that would otherwise have completed fine without it.
      if (action.onError === 'skip' || action.onError === 'ignore') {
        settle({ status: 'skipped', message });
        await publish(state);
        await delay(STEP_SETTLE_MS);
        continue;
      }

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
        if (stepResult.error) {
          // Same onError:'skip'/'ignore' contract as the plain replay loop
          // above — a step expected to sometimes not be there (a popup that
          // doesn't always appear) must not fail the whole row.
          const onError = actions[a].onError;
          if (onError === 'skip' || onError === 'ignore') continue;
          throw new Error(`${actions[a].type}: ${stepResult.error}`);
        }
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
      recordingTabId = null;
      clearSession();
      attachToActiveTab(settings.highlightElements).then(async (error) => {
        if (error) {
          recording = false;
          log('attach failed', error);
        } else {
          recordingTabId = (await getActiveTab())?.id ?? null;
        }
        notifyRecordingState();
        sendResponse({ recording, actions, error });
      });
      return true; // async sendResponse

    case 'STOP_RECORDING':
      recording = false;
      recordingTabId = null;
      notifyRecordingState();
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

    case 'ADD_ACTION':
      actions.push({ ...message.action, id: `step-${++stepCounter}` } as WorkflowAction);
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

    case 'GET_EMAIL_SETTINGS':
      sendResponse(emailSettings);
      return;

    case 'OPEN_REPORT':
      openReportWindow(message.recordingId);
      return;

    case 'SET_EMAIL_SETTINGS':
      emailSettings = message.settings;
      saveEmailSettings(emailSettings);
      sendResponse(emailSettings);
      return;

    case 'REPLAY_START':
      if (replaying) return;
      recording = false; // otherwise the recorder would capture the replay's own clicks
      notifyRecordingState();
      detachFromActiveTab();
      replaying = true;
      runReplay(actions, message.background, publishReplayState).finally(() => {
        replaying = false;
      });
      return;

    case 'GET_REPLAY_STATE':
      // storage, not memory: the worker may have been restarted since the replay
      loadReplayState().then((stored) => sendResponse(markStalled(stored ?? replayState)));
      return true; // async sendResponse

    // Always in its own off-screen window (openReportPreviewWindow): a
    // Report compose window has no "active tab" of its own to run against,
    // and must not disturb whatever the user is doing in their real tabs or
    // interrupt an in-progress recording.
    case 'REPLAY_REPORT_PREVIEW': {
      const { recordingId } = message;
      if (reportPreviewRunning.has(recordingId)) {
        // A step that never responds (chrome.tabs.sendMessage has no timeout
        // of its own) leaves runReplay's promise permanently pending, so its
        // .finally() below never fires and this guard would otherwise stay
        // set forever — the same staleness markStalled already detects for
        // display purposes means it is safe to let a fresh attempt start.
        const stalled = markStalled(reportPreviewStates[recordingId] ?? null);
        if (stalled?.running !== false) return; // still genuinely in progress
        reportPreviewRunning.delete(recordingId);
      }
      reportPreviewRunning.add(recordingId);
      runReplay(
        message.actions,
        true,
        (state) => publishReportPreviewState(recordingId, state),
        openReportPreviewWindow,
      ).finally(() => {
        reportPreviewRunning.delete(recordingId);
      });
      return;
    }

    case 'GET_REPORT_PREVIEW_STATE':
      loadReportPreviewState(message.recordingId).then((stored) =>
        sendResponse(markStalled(stored ?? reportPreviewStates[message.recordingId] ?? null)),
      );
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
      if (recordingTabId !== null && tabId !== recordingTabId) return; // a click in a tab that isn't part of this recording
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
// Only for the tab the user is actually looking at: without this check, any
// other open tab reloading or redirecting in the background (an ad, a stale
// tab left auto-refreshing) would inject a navigate step into the recording.
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (!recording || details.frameId !== 0) return;
  const tab = await getActiveTab();
  if (tab?.id !== details.tabId) return;
  recordingTabId = details.tabId; // covers a deliberate switch to a newly opened, now-focused tab
  pushAction({ id: `step-${++stepCounter}`, type: 'navigate', url: details.url }, details.tabId);
});

chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (!recording || details.frameId !== 0) return;
  const tab = await getActiveTab();
  if (tab?.id === details.tabId) await attachToActiveTab(settings.highlightElements);
});
