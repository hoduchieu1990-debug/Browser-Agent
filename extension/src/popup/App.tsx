import { useEffect, useState } from 'react';
import type {
  WorkflowAction,
  RuntimeMessage,
  RecorderState,
  RecorderSettings,
  ReplayState,
  SavedRecording,
} from '../types';
import { DEFAULT_SETTINGS } from '../types';
import { Header } from './Header';
import { Tabs, type TabKey } from './Tabs';
import { RecordTab } from './RecordTab';
import { PreviewTab } from './PreviewTab';
import { SavedTab } from './SavedTab';
import { ExportTab } from './ExportTab';
import { SettingsTab } from './SettingsTab';
import { Footer } from './Footer';

export function App() {
  const [recording, setRecording] = useState(false);
  const [actions, setActions] = useState<WorkflowAction[]>([]);
  const [settings, setSettings] = useState<RecorderSettings>(DEFAULT_SETTINGS);
  const [activeTab, setActiveTab] = useState<TabKey>('recording');
  const [error, setError] = useState<string | null>(null);
  const [replayState, setReplayState] = useState<ReplayState | null>(null);
  const [recordings, setRecordings] = useState<SavedRecording[]>([]);
  const [replayInBackground, setReplayInBackground] = useState(false);

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

    const pullReplayState = () => {
      chrome.runtime.sendMessage({ type: 'GET_REPLAY_STATE' } satisfies RuntimeMessage, (state: ReplayState | null) => {
        setReplayState(state);
        if (state?.running) setActiveTab('preview'); // land where the progress is
      });
    };

    pullReplayState();
    // Broadcasts sent while the popup was closed are lost, so poll as well —
    // this is what keeps progress moving after the page steals focus.
    const poll = window.setInterval(pullReplayState, 1000);

    const listener = (message: RuntimeMessage) => {
      if (message.type === 'ACTIONS_UPDATED') setActions(message.actions);
      if (message.type === 'RECORDINGS_UPDATED') setRecordings(message.recordings);
      if (message.type === 'REPLAY_UPDATED') setReplayState(message.state);
    };
    chrome.runtime.onMessage.addListener(listener);

    return () => {
      clearInterval(poll);
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, []);

  const toggleRecording = () => {
    const type = recording ? 'STOP_RECORDING' : 'START_RECORDING';
    chrome.runtime.sendMessage({ type } satisfies RuntimeMessage, (state: RecorderState) => {
      setRecording(state.recording);
      setActions(state.actions);
      setError(state.error ?? null);
    });
  };

  const removeAction = (index: number) => {
    chrome.runtime.sendMessage({ type: 'REMOVE_ACTION', index } satisfies RuntimeMessage);
  };

  const resetActions = () => {
    if (actions.length > 0 && !window.confirm(`Discard all ${actions.length} recorded action(s)?`)) return;
    chrome.runtime.sendMessage({ type: 'RESET' } satisfies RuntimeMessage, (state: RecorderState) => {
      setActions(state.actions);
    });
  };

  const loadRecording = (id: string) => {
    chrome.runtime.sendMessage({ type: 'LOAD_RECORDING', id } satisfies RuntimeMessage, (state: RecorderState) => {
      setActions(state.actions);
      setReplayState(null);
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
    const next = { ...settings, [key]: value };
    setSettings(next);
    chrome.runtime.sendMessage({ type: 'SET_SETTINGS', settings: next } satisfies RuntimeMessage);
  };

  return (
    <div className="popup">
      <Header onOpenSettings={() => setActiveTab('settings')} />
      <Tabs active={activeTab} onChange={setActiveTab} />
      <div className="popup-content">
        {activeTab === 'recording' && (
          <RecordTab
            recording={recording}
            actions={actions}
            error={error}
            onToggleRecording={toggleRecording}
            onRemoveAction={removeAction}
            onReset={resetActions}
          />
        )}
        {activeTab === 'preview' && (
          <PreviewTab
            actions={actions}
            state={replayState}
            background={replayInBackground}
            onBackgroundChange={setReplayInBackground}
            onReplay={startReplay}
          />
        )}
        {activeTab === 'saved' && (
          <SavedTab recordings={recordings} onLoad={loadRecording} onDelete={removeRecording} />
        )}
        {activeTab === 'export' && <ExportTab actions={actions} recordings={recordings} settings={settings} />}
        {activeTab === 'settings' && <SettingsTab settings={settings} onChange={updateSetting} />}
      </div>
      <Footer actionCount={actions.length} />
    </div>
  );
}
