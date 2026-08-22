import type { TabKey } from './Sidebar';

const TITLES: Record<TabKey, string> = {
  recording: 'Record',
  preview: 'Preview',
  saved: 'Saved',
  export: 'Export',
  batch: 'Batch',
  settings: 'Settings',
  about: 'About',
};

interface Props {
  active: TabKey;
  actionCount: number;
}

export function Header({ active, actionCount }: Props) {
  return (
    <header className="popup-header">
      <nav className="breadcrumb">
        <span className="breadcrumb-parent">Browser Agent</span>
        <span className="breadcrumb-separator">/</span>
        <span className="breadcrumb-current">{TITLES[active]}</span>
      </nav>
      <span className="action-count">{actionCount}</span>
    </header>
  );
}
