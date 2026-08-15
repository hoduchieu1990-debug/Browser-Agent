interface Props {
  onOpenSettings: () => void;
}

export function Header({ onOpenSettings }: Props) {
  return (
    <div className="popup-header">
      <div className="popup-header-content">
        <div className="logo-badge">BA</div>
        <h2>Browser Agent</h2>
      </div>
      <div className="popup-header-buttons">
        <button className="header-btn" title="Settings" onClick={onOpenSettings}>
          ⚙️
        </button>
        <button className="header-btn" title="docs/WORKFLOW_GUIDE.md">
          ❓
        </button>
      </div>
    </div>
  );
}
