import { useEffect, useState } from 'react';
import type { RuntimeMessage, SavedRecording, RecorderSettings, EmailSettings } from '../types';
import { DEFAULT_SETTINGS, DEFAULT_EMAIL_SETTINGS } from '../types';
import { ReportComposer } from './ReportComposer';

interface Props {
  recordingId: string;
}

// A standalone window (background.ts's openReportWindow) reachable only via
// popup.html?report=<id> — it has none of App.tsx's state, so it fetches
// its own copy of the same three things the main popup already loads on
// mount (GET_RECORDINGS/GET_SETTINGS/GET_EMAIL_SETTINGS).
export function ReportComposerPage({ recordingId }: Props) {
  const [recording, setRecording] = useState<SavedRecording | null>(null);
  const [settings, setSettings] = useState<RecorderSettings>(DEFAULT_SETTINGS);
  const [emailSettings, setEmailSettings] = useState<EmailSettings>(DEFAULT_EMAIL_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_RECORDINGS' } satisfies RuntimeMessage, (list: SavedRecording[]) => {
      setRecording(list.find((r) => r.id === recordingId) ?? null);
    });
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' } satisfies RuntimeMessage, (s: RecorderSettings) => {
      setSettings(s ?? DEFAULT_SETTINGS);
    });
    chrome.runtime.sendMessage({ type: 'GET_EMAIL_SETTINGS' } satisfies RuntimeMessage, (s: EmailSettings) => {
      setEmailSettings(s ?? DEFAULT_EMAIL_SETTINGS);
      setLoaded(true);
    });
  }, [recordingId]);

  const addRecipient = (email: string) => {
    if (!email.trim() || emailSettings.recipients.includes(email)) return;
    const next = { ...emailSettings, recipients: [...emailSettings.recipients, email] };
    setEmailSettings(next);
    chrome.runtime.sendMessage({ type: 'SET_EMAIL_SETTINGS', settings: next } satisfies RuntimeMessage);
  };

  if (!loaded) return null;
  if (!recording) return <div className="empty-state">This recording no longer exists.</div>;

  return (
    <ReportComposer recording={recording} settings={settings} emailSettings={emailSettings} onAddRecipient={addRecipient} />
  );
}
