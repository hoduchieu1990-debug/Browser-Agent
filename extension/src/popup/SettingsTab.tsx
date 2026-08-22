import type { RecorderSettings } from '../types';

interface Props {
  settings: RecorderSettings;
  onChange: (key: keyof RecorderSettings, value: boolean) => void;
}

const ITEMS: { key: keyof RecorderSettings; name: string; desc: string }[] = [
  { key: 'autoDismissPopup', name: 'Auto-dismiss Popups', desc: 'Bake into exported workflow' },
  { key: 'captureScreenshots', name: 'Capture Screenshots', desc: 'Add a screenshot step after each action' },
  { key: 'highlightElements', name: 'Highlight Elements', desc: 'Outline element under cursor while recording' },
  { key: 'onPageConfirmation', name: 'On-page Confirmation', desc: 'Toast on the page after each recorded step' },
  { key: 'pinSide', name: 'Pin to Side', desc: 'Dock to the right edge; the page shrinks beside it' },
  { key: 'verboseLogging', name: 'Verbose Logging', desc: 'Log extension activity to the console' },
];

export function SettingsTab({ settings, onChange }: Props) {
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
    </div>
  );
}
