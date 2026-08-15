export type TabKey = 'recording' | 'preview' | 'saved' | 'export' | 'settings';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'recording', label: 'Record' },
  { key: 'preview', label: 'Preview' },
  { key: 'saved', label: 'Saved' },
  { key: 'export', label: 'Export' },
  { key: 'settings', label: 'Settings' },
];

interface Props {
  active: TabKey;
  onChange: (tab: TabKey) => void;
}

export function Tabs({ active, onChange }: Props) {
  return (
    <div className="popup-tabs">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          className={tab.key === active ? 'tab active' : 'tab'}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
