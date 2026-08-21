import { useEffect, useState } from 'react';
import type {
  WorkflowAction,
  RuntimeMessage,
  RecorderState,
  RecorderSettings,
  ReplayState,
  SavedRecording,
  BatchDataset,
  BatchReplayState,
} from '../types';
import { DEFAULT_SETTINGS } from '../types';
import { Header } from './Header';
import { Sidebar, type TabKey } from './Sidebar';
import { RecordTab } from './RecordTab';
import { PreviewTab } from './PreviewTab';
import { SavedTab } from './SavedTab';
import { ExportTab } from './ExportTab';
import { BatchTab } from './BatchTab';
import { SettingsTab } from './SettingsTab';
import { AboutTab } from './AboutTab';

// This same page runs in three places, and only two of them should vanish
// when recording starts:
//   - the real toolbar popup: no tab of its own, window.close() works
//   - the window Stop reopens: a 'popup'-type window, needs windows.remove
//     (window.close() is refused for windows the page didn't itself open)
//   - a plain tab someone navigated to popup.html: closing the whole window
//     would take their other tabs with it, so leave it alone
async function dismissSelf(): Promise<void> {
  const tab = await chrome.tabs.getCurrent();
  if (!tab) {
    window.close();
    return;
  }

  const win = await chrome.windows.getCurrent();
  if (win.type === 'popup' && win.id !== undefined) {
    chrome.runtime.sendMessage({ type: 'CLOSE_POPUP', windowId: win.id } satisfies RuntimeMessage);
  }
}

export function App() {
  const [recording, setRecording] = useState(false);
  const [actions, setActions] = useState<WorkflowAction[]>([]);
  const [settings, setSettings] = useState<RecorderSettings>(DEFAULT_SETTINGS);
  const [activeTab, setActiveTab] = useState<TabKey>('recording');
  const [error, setError] = useState<string | null>(null);
  const [replayState, setReplayState] = useState<ReplayState | null>(null);
  const [recordings, setRecordings] = useState<SavedRecording[]>([]);
  const [replayInBackground, setReplayInBackground] = useState(false);
  const [batchDataset, setBatchDataset] = useState<BatchDataset | null>(null);
  const [batchState, setBatchState] = useState<BatchReplayState | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  // Looked up ahead of time: sidePanel.open() must be called straight out of
  // the click, and awaiting the window there would spend the gesture.
  const [currentWindowId, setCurrentWindowId] = useState<number | null>(null);

  const hasBatchNodes = actions.some((a) => a.type.startsWith('batch'));

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_STATE' } satisfies RuntimeMessage, (state: RecorderState) => {
      setRecording(state.recording);
      setActions(state.actions);
    });
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' } satisfies RuntimeMessage, (s: RecorderSettings) => {
      setSettings(s);
    });
    chrome.runtime.sendMessage({ type: 'GET_RECORDINGS' } satisfies RuntimeMessage, (list: SavedRecording[]) => {
      setRecordings(list);
    });
    chrome.runtime.sendMessage({ type: 'BATCH_GET_DATASET' } satisfies RuntimeMessage, (dataset: BatchDataset | null) => {
      setBatchDataset(dataset);
    });
    chrome.runtime.sendMessage({ type: 'GET_THUMBNAILS' } satisfies RuntimeMessage, (saved: Record<string, string>) => {
      setThumbnails(saved ?? {});
    });
    chrome.windows.getCurrent().then((win) => setCurrentWindowId(win.id ?? null));

    const pullReplayState = () => {
      chrome.runtime.sendMessage({ type: 'GET_REPLAY_STATE' } satisfies RuntimeMessage, (state: ReplayState | null) => {
        setReplayState(state);
        if (state?.running) setActiveTab('preview'); // land where the progress is
      });
    };

    const pullBatchState = () => {
      chrome.runtime.sendMessage(
        { type: 'BATCH_GET_STATE' } satisfies RuntimeMessage,
        (state: BatchReplayState | null) => {
          setBatchState(state);
          if (state?.running) setActiveTab('batch');
        },
      );
    };

    pullReplayState();
    pullBatchState();
    // Broadcasts sent while the popup was closed are lost, so poll as well —
    // this is what keeps progress moving after the page steals focus.
    const poll = window.setInterval(() => {
      pullReplayState();
      pullBatchState();
    }, 1000);

    const listener = (message: RuntimeMessage) => {
      if (message.type === 'ACTIONS_UPDATED') setActions(message.actions);
      if (message.type === 'RECORDING_UPDATED') setRecording(message.recording);
      if (message.type === 'RECORDINGS_UPDATED') setRecordings(message.recordings);
      if (message.type === 'REPLAY_UPDATED') setReplayState(message.state);
      if (message.type === 'BATCH_UPDATED') setBatchState(message.state);
      if (message.type === 'THUMBNAIL_READY') {
        setThumbnails((prev) => ({ ...prev, [message.actionId]: message.dataUrl }));
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    return () => {
      clearInterval(poll);
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, []);

  const toggleRecording = () => {
    const starting = !recording;
    const type = starting ? 'START_RECORDING' : 'STOP_RECORDING';
    chrome.runtime.sendMessage({ type } satisfies RuntimeMessage, async (state: RecorderState) => {
      setRecording(state.recording);
      setActions(state.actions);
      setError(state.error ?? null);
      // Get out of the way once recording actually starts, so the page is
      // clear to interact with — stopping (from the on-page badge) reopens
      // this same popup to review the result. Pinned is the exception: there
      // the whole point is that it stays put and the page reflows beside it.
      if (starting && state.recording && !state.error && !settings.pinSide) await dismissSelf();
    });
  };

  const removeAction = (index: number) => {
    chrome.runtime.sendMessage({ type: 'REMOVE_ACTION', index } satisfies RuntimeMessage);
  };

  const updateAction = (index: number, patch: Record<string, unknown>) => {
    chrome.runtime.sendMessage({ type: 'UPDATE_ACTION', index, patch } satisfies RuntimeMessage);
  };

  const setDataset = (dataset: BatchDataset) => {
    chrome.runtime.sendMessage(
      { type: 'BATCH_SET_DATASET', ...dataset } satisfies RuntimeMessage,
      (saved: BatchDataset) => setBatchDataset(saved),
    );
  };

  const testRow = () => {
    setActiveTab('batch');
    chrome.runtime.sendMessage({ type: 'BATCH_TEST_ROW' } satisfies RuntimeMessage);
  };

  const runAll = (stopOnError: boolean) => {
    setActiveTab('batch');
    chrome.runtime.sendMessage({ type: 'BATCH_RUN_ALL', stopOnError } satisfies RuntimeMessage);
  };

  const stopBatch = () => {
    chrome.runtime.sendMessage({ type: 'BATCH_STOP' } satisfies RuntimeMessage);
  };

  // confirmation lives in RecordTab: a native confirm() dialog is a full browser
  // modal, far too heavy next to a 400px popup
  const resetActions = () => {
    chrome.runtime.sendMessage({ type: 'RESET' } satisfies RuntimeMessage, (state: RecorderState) => {
      setActions(state.actions);
      setThumbnails({});
    });
  };

  const loadRecording = (id: string) => {
    chrome.runtime.sendMessage({ type: 'LOAD_RECORDING', id } satisfies RuntimeMessage, (state: RecorderState) => {
      setActions(state.actions);
      setReplayState(null);
      setThumbnails({}); // a saved recording never captured them
      setActiveTab('preview'); // loading is only useful next to Replay/Export
    });
  };

  const removeRecording = (id: string) => {
    chrome.runtime.sendMessage({ type: 'DELETE_RECORDING', id } satisfies RuntimeMessage, (list: SavedRecording[]) => {
      setRecordings(list);
    });
  };

  const startReplay = () => {
    setReplayState({ running: true, total: actions.length, steps: [], variables: {}, startedAt: Date.now(), updatedAt: Date.now() });
    setRecording(false); // the background stops recording so the replay isn't captured
    chrome.runtime.sendMessage({ type: 'REPLAY_START', background: replayInBackground } satisfies RuntimeMessage);
  };

  const updateSetting = (key: keyof RecorderSettings, value: boolean) => {
    // Turning Pin on takes effect at once, so the user is not left in an
    // ordinary popup that still vanishes at the first click on the page.
    // This runs before anything else because sidePanel.open() insists on the
    // gesture that triggered it, and only a direct call from the click keeps
    // it — relaying the request through the background loses it.
    if (key === 'pinSide' && value && currentWindowId !== null) {
      chrome.sidePanel
        .open({ windowId: currentWindowId })
        .then(() => dismissSelf())
        .catch(() => {}); // the toolbar button opens it either way
    }

    const next = { ...settings, [key]: value };
    setSettings(next);
    chrome.runtime.sendMessage({ type: 'SET_SETTINGS', settings: next } satisfies RuntimeMessage);
  };

  return (
    <div className="popup">
      <Sidebar active={activeTab} onChange={setActiveTab} showBatch={hasBatchNodes} />
      <div className="popup-main">
        <Header active={activeTab} actionCount={actions.length} />
        <div className="popup-content">
          {activeTab === 'recording' && (
            <RecordTab
              recording={recording}
              actions={actions}
              error={error}
              datasetHeaders={batchDataset?.headers ?? []}
              thumbnails={thumbnails}
              onToggleRecording={toggleRecording}
              onRemoveAction={removeAction}
              onUpdateAction={updateAction}
              onReset={resetActions}
            />
          )}
          {activeTab === 'preview' && (
            <PreviewTab
              actions={actions}
              state={replayState}
              background={replayInBackground}
              thumbnails={thumbnails}
              onBackgroundChange={setReplayInBackground}
              onReplay={startReplay}
            />
          )}
          {activeTab === 'saved' && (
            <SavedTab recordings={recordings} onLoad={loadRecording} onDelete={removeRecording} />
          )}
          {activeTab === 'export' && <ExportTab actions={actions} recordings={recordings} settings={settings} />}
          {activeTab === 'batch' && (
            <BatchTab
              actions={actions}
              dataset={batchDataset}
              state={batchState}
              onSetDataset={setDataset}
              onTestRow={testRow}
              onRunAll={runAll}
              onStop={stopBatch}
            />
          )}
          {activeTab === 'settings' && <SettingsTab settings={settings} onChange={updateSetting} />}
          {activeTab === 'about' && <AboutTab />}
        </div>
      </div>
    </div>
  );
}
