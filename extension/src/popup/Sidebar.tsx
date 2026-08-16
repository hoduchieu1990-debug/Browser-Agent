export type TabKey = 'recording' | 'preview' | 'saved' | 'export' | 'batch' | 'settings' | 'about';

interface Item {
  key: TabKey;
  label: string;
  icon: JSX.Element;
}

// Lucide-style line icons, inlined so the popup pulls in no icon dependency.
const ITEMS: Item[] = [
  {
    key: 'recording',
    label: 'Record',
    icon: <circle cx="12" cy="12" r="7" />,
  },
  {
    key: 'preview',
    label: 'Preview',
    icon: <polygon points="7 4 19 12 7 20 7 4" />,
  },
  {
    key: 'saved',
    label: 'Saved',
    icon: (
      <>
        <rect x="3" y="4" width="18" height="5" rx="1" />
        <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" />
        <line x1="10" y1="13" x2="14" y2="13" />
      </>
    ),
  },
  {
    key: 'export',
    label: 'Export',
    icon: (
      <>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </>
    ),
  },
  {
    key: 'batch',
    label: 'Batch',
    icon: (
      <>
        <rect x="3" y="4" width="7" height="7" rx="1" />
        <rect x="14" y="4" width="7" height="7" rx="1" />
        <rect x="3" y="15" width="7" height="5" rx="1" />
        <rect x="14" y="15" width="7" height="5" rx="1" />
      </>
    ),
  },
  {
    key: 'settings',
    label: 'Settings',
    icon: (
      <>
        <line x1="21" y1="6" x2="10" y2="6" />
        <line x1="6" y1="6" x2="3" y2="6" />
        <line x1="21" y1="12" x2="14" y2="12" />
        <line x1="10" y1="12" x2="3" y2="12" />
        <line x1="21" y1="18" x2="16" y2="18" />
        <line x1="12" y1="18" x2="3" y2="18" />
        <line x1="8" y1="4" x2="8" y2="8" />
        <line x1="12" y1="10" x2="12" y2="14" />
        <line x1="14" y1="16" x2="14" y2="20" />
      </>
    ),
  },
  {
    key: 'about',
    label: 'About',
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="11" x2="12" y2="16" />
        <line x1="12" y1="7.5" x2="12" y2="7.5" />
      </>
    ),
  },
];

interface Props {
  active: TabKey;
  onChange: (tab: TabKey) => void;
  /** The Batch tab only makes sense once the recording has a batch node. */
  showBatch: boolean;
}

export function Sidebar({ active, onChange, showBatch }: Props) {
  const items = ITEMS.filter((item) => item.key !== 'batch' || showBatch);

  return (
    <nav className="sidebar">
      <div className="sidebar-brand" title="Browser Agent">
        BA
      </div>

      {items.map((item) => (
        <button
          key={item.key}
          className={item.key === active ? 'sidebar-item active' : 'sidebar-item'}
          onClick={() => onChange(item.key)}
          title={item.label}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {item.icon}
          </svg>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
