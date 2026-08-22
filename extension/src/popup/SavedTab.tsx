import type { SavedRecording } from '../types';

interface Props {
  recordings: SavedRecording[];
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function summarise(recording: SavedRecording): string {
  const extracts = recording.actions.filter((a) => a.type.startsWith('extract')).length;
  const parts = [`${recording.actions.length} actions`];
  if (extracts > 0) parts.push(`${extracts} extraction${extracts === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

export function SavedTab({ recordings, onLoad, onDelete }: Props) {
  if (recordings.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">🗂️</div>
        <strong>No saved recordings</strong>
        <p>Each recording is saved here automatically when you press Stop.</p>
      </div>
    );
  }

  return (
    <div className="saved-list">
      {recordings.map((recording) => (
        <div className="saved-item" key={recording.id}>
          <div className="saved-info">
            <div className="saved-name">{recording.name}</div>
            <div className="saved-meta">{formatTime(recording.createdAt)}</div>
            <div className="saved-meta">{summarise(recording)}</div>
          </div>
          <div className="saved-actions">
            <button className="saved-load" onClick={() => onLoad(recording.id)}>
              Load
            </button>
            <button className="action-delete" onClick={() => onDelete(recording.id)}>
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
