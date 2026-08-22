import type { RecorderSettings, EmailSettings } from '../types';

interface Props {
  settings: RecorderSettings;
  onChange: (key: keyof RecorderSettings, value: boolean) => void;
  emailSettings: EmailSettings;
  onEmailSettingsChange: (patch: Partial<EmailSettings>) => void;
}

const ITEMS: { key: keyof RecorderSettings; name: string; desc: string }[] = [
  { key: 'autoDismissPopup', name: 'Auto-dismiss Popups', desc: 'Bake into exported workflow' },
  { key: 'captureScreenshots', name: 'Capture Screenshots', desc: 'Add a screenshot step after each action' },
  { key: 'highlightElements', name: 'Highlight Elements', desc: 'Outline element under cursor while recording' },
  { key: 'onPageConfirmation', name: 'On-page Confirmation', desc: 'Toast on the page after each recorded step' },
  { key: 'pinSide', name: 'Pin to Side', desc: 'Dock to the right edge; the page shrinks beside it' },
  { key: 'verboseLogging', name: 'Verbose Logging', desc: 'Log extension activity to the console' },
];

export function SettingsTab({ settings, onChange, emailSettings, onEmailSettingsChange }: Props) {
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

      <div className="settings-section-title">Email (SMTP) — used by every scheduled report</div>

      <div className="form-group">
        <label className="form-label">SMTP host</label>
        <input
          className="form-input"
          type="text"
          placeholder="smtp.samsung.net"
          value={emailSettings.host}
          onChange={(e) => onEmailSettingsChange({ host: e.target.value })}
        />
      </div>

      <div className="smtp-row">
        <div className="form-group">
          <label className="form-label">Port</label>
          <input
            className="form-input"
            type="number"
            value={emailSettings.port}
            onChange={(e) => onEmailSettingsChange({ port: parseInt(e.target.value, 10) || 25 })}
          />
        </div>
        <label className="result-key-item smtp-secure-toggle">
          <input
            type="checkbox"
            checked={emailSettings.secure}
            onChange={(e) => onEmailSettingsChange({ secure: e.target.checked })}
          />
          Secure (TLS)
        </label>
      </div>

      <div className="form-group">
        <label className="form-label">SMTP user (optional)</label>
        <input
          className="form-input"
          type="text"
          value={emailSettings.user}
          onChange={(e) => onEmailSettingsChange({ user: e.target.value })}
        />
      </div>

      <div className="form-group">
        <label className="form-label">SMTP password (optional)</label>
        <input
          className="form-input"
          type="password"
          value={emailSettings.pass}
          onChange={(e) => onEmailSettingsChange({ pass: e.target.value })}
        />
      </div>

      <div className="form-group">
        <label className="form-label">From (optional)</label>
        <input
          className="form-input"
          type="text"
          placeholder={emailSettings.user || 'defaults to SMTP user'}
          value={emailSettings.from}
          onChange={(e) => onEmailSettingsChange({ from: e.target.value })}
        />
      </div>

      <p className="form-hint">
        Recipients are picked per schedule, from the Saved tab's ⏰ Schedule form.
      </p>
    </div>
  );
}
