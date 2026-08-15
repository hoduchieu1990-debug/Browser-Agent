import type { WorkflowAction } from '../types';
import { actionSelectorText, actionValueText } from '../utils/action-display';

interface Props {
  recording: boolean;
  actions: WorkflowAction[];
  error: string | null;
  onToggleRecording: () => void;
  onRemoveAction: (index: number) => void;
  onReset: () => void;
}

export function RecordTab({ recording, actions, error, onToggleRecording, onRemoveAction, onReset }: Props) {
  return (
    <div>
      <div className="recording-controls">
        <button className="record-btn start" disabled={recording} onClick={onToggleRecording}>
          ⭕ Start
        </button>
        <button className="record-btn stop" disabled={!recording} onClick={onToggleRecording}>
          ⏹️ Stop
        </button>
      </div>

      <div className="recording-status">
        <div className={recording ? 'recording-dot live' : 'recording-dot'} />
        <span>{recording ? 'Recording…' : 'Ready to record'}</span>
      </div>

      {error && <div className="error-banner">⚠️ {error}</div>}

      {recording && (
        <div className="extract-hint">
          💡 Hover anything on the page, then click <strong>＋ Add</strong> to capture it as table data, a text value,
          or an image.
        </div>
      )}

      <div className="actions-toolbar">
        <span>
          {actions.length} action{actions.length === 1 ? '' : 's'}
        </span>
        <button className="reset-btn" disabled={actions.length === 0} onClick={onReset}>
          ↺ Reset
        </button>
      </div>

      {actions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">✨</div>
          <strong>No actions yet</strong>
          <p>Click Start, then interact with the page.</p>
        </div>
      ) : (
        <div className="actions-list">
          {actions.map((action, index) => (
            <div className="action-item" key={action.id}>
              <div className="action-step">{index + 1}</div>
              <div className="action-info">
                <div className="action-type">{action.type}</div>
                <div className="action-selector">{actionSelectorText(action)}</div>
                {actionValueText(action) && <div className="action-value">{actionValueText(action)}</div>}
              </div>
              <button className="action-delete" onClick={() => onRemoveAction(index)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
