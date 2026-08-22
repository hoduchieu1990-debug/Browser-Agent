import { useState } from 'react';
import type { RecorderSettings, EmailSettings } from '../types';

interface Props {
  settings: RecorderSettings;
  onChange: (key: keyof RecorderSettings, value: boolean) => void;
  emailSettings: EmailSettings;
  onEmailSettingsChange: (patch: Partial<EmailSettings>) => void;
  onAddRecipient: (email: string) => void;
  onRemoveRecipient: (email: string) => void;
}

const ITEMS: { key: keyof RecorderSettings; name: string; desc: string }[] = [
  { key: 'autoDismissPopup', name: 'Auto-dismiss Popups', desc: 'Bake into exported workflow' },
  { key: 'captureScreenshots', name: 'Capture Screenshots', desc: 'Add a screenshot step after each action' },
  { key: 'highlightElements', name: 'Highlight Elements', desc: 'Outline element under cursor while recording' },
  { key: 'onPageConfirmation', name: 'On-page Confirmation', desc: 'Toast on the page after each recorded step' },
  { key: 'pinSide', name: 'Pin to Side', desc: 'Dock to the right edge; the page shrinks beside it' },
  { key: 'verboseLogging', name: 'Verbose Logging', desc: 'Log extension activity to the console' },
];

export function SettingsTab({
  settings,
  onChange,
  emailSettings,
  onEmailSettingsChange,
  onAddRecipient,
  onRemoveRecipient,
}: Props) {
  const [emailExpanded, setEmailExpanded] = useState(false);
  const [newRecipient, setNewRecipient] = useState('');

  const addRecipient = () => {
    const email = newRecipient.trim();
    if (!email) return;
    onAddRecipient(email);
    setNewRecipient('');
  };

  return (
    <div className="settings-list">
      {ITEMS.map((item) => (
        <div className="setting-item" key={item.key}>
          <div className="setting-label">
            <div className="setting-name">{item.name}</div>
            <div className="setting-desc">{item.desc}</div>
          </div>
          <button
            className={settings[item.key] ? 'toggle on' : 'toggle'}
            onClick={() => onChange(item.key, !settings[item.key])}
          >
            <div className="toggle-circle" />
          </button>
        </div>
      ))}

      <button className="setting-item email-toggle-btn" onClick={() => setEmailExpanded(!emailExpanded)}>
        <div className="setting-label">
          <div className="setting-name">✉️ Email</div>
          <div className="setting-desc">Account and recipients for scheduled reports</div>
        </div>
        <span className={emailExpanded ? 'email-toggle-chevron open' : 'email-toggle-chevron'}>▾</span>
      </button>

      {emailExpanded && (
        <div className="schedule-panel">
          <div className="form-group">
            <label className="form-label">Email address</label>
            <input
              className="form-input"
              type="text"
              placeholder="you@samsung.com"
              value={emailSettings.user}
              onChange={(e) => onEmailSettingsChange({ user: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              className="form-input"
              type="password"
              value={emailSettings.pass}
              onChange={(e) => onEmailSettingsChange({ pass: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Recipients</label>
            {emailSettings.recipients.length > 0 && (
              <div className="result-key-list">
                {emailSettings.recipients.map((email) => (
                  <div className="recipient-row" key={email}>
                    <span>{email}</span>
                    <button className="action-delete" onClick={() => onRemoveRecipient(email)}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="recipient-add-row">
              <input
                className="form-input"
                type="text"
                placeholder="Add a new recipient…"
                value={newRecipient}
                onChange={(e) => setNewRecipient(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addRecipient();
                  }
                }}
              />
              <button className="saved-load" onClick={addRecipient}>
                + Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
