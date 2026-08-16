const DEVELOPER_EMAIL = 'hieu.hd@samsung.com';

export function AboutTab() {
  const version = chrome.runtime.getManifest().version;

  return (
    <div className="about-panel">
      <div className="about-logo">BA</div>
      <h2 className="about-title">Browser Agent</h2>
      <p className="about-version">Version {version}</p>

      <div className="form-group">
        <span className="form-label">Developed by</span>
        <a className="about-email" href={`mailto:${DEVELOPER_EMAIL}`}>
          {DEVELOPER_EMAIL}
        </a>
      </div>

      <p className="form-hint">Record browser actions and replay them — one row or a whole dataset at a time.</p>
    </div>
  );
}
