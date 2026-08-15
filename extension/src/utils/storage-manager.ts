import type { WorkflowAction, RecorderSettings, SavedRecording, ReplayState } from '../types';
import { DEFAULT_SETTINGS } from '../types';

const DB_NAME = 'browser-agent';
const STORE_NAME = 'session';
const SETTINGS_KEY = 'browser-agent-settings';
const RECORDINGS_KEY = 'browser-agent-recordings';
const REPLAY_STATE_KEY = 'browser-agent-replay-state';
const MAX_RECORDINGS = 50;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveSession(actions: WorkflowAction[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(actions, 'current');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadSession(): Promise<WorkflowAction[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get('current');
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error);
  });
}

export async function clearSession(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete('current');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveSettings(settings: RecorderSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function loadSettings(): Promise<RecorderSettings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] as Partial<RecorderSettings> | undefined) };
}

export async function loadRecordings(): Promise<SavedRecording[]> {
  const result = await chrome.storage.local.get(RECORDINGS_KEY);
  return (result[RECORDINGS_KEY] as SavedRecording[] | undefined) ?? [];
}

export async function addRecording(recording: SavedRecording): Promise<SavedRecording[]> {
  const recordings = [recording, ...(await loadRecordings())].slice(0, MAX_RECORDINGS);
  await chrome.storage.local.set({ [RECORDINGS_KEY]: recordings });
  return recordings;
}

export async function deleteRecording(id: string): Promise<SavedRecording[]> {
  const recordings = (await loadRecordings()).filter((r) => r.id !== id);
  await chrome.storage.local.set({ [RECORDINGS_KEY]: recordings });
  return recordings;
}

// The popup closes the moment a replay navigates the page, and MV3 may shut the
// service worker down mid-run — storage is the only place progress survives
// both, so it is the source of truth the popup reads on open.
export async function saveReplayState(state: ReplayState): Promise<void> {
  await chrome.storage.local.set({ [REPLAY_STATE_KEY]: state });
}

export async function loadReplayState(): Promise<ReplayState | null> {
  const result = await chrome.storage.local.get(REPLAY_STATE_KEY);
  return (result[REPLAY_STATE_KEY] as ReplayState | undefined) ?? null;
}
