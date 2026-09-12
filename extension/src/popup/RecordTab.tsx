import { useEffect, useState } from 'react';
import type { WorkflowAction, RecordedActionPayload } from '../types';
import {
  actionSelectorText,
  actionValueText,
  actionTypeIcon,
  batchNodeLabel,
  isCliOnlyAction,
} from '../utils/action-display';
import { BatchNodeConfig } from './BatchNodeConfig';
import { PluginActionConfig } from './PluginActionConfig';
import { AddStepMenu } from './AddStepMenu';
import { ActionThumb } from './ActionThumb';

const CONFIRM_TIMEOUT_MS = 4000;

const PLUGIN_ACTION_TYPES = new Set([
  'mailSend',
  'mailRead',
  'mailSearch',
  'mailAttachment',
  'fileReadExcel',
  'fileWriteExcel',
  'fileReadPdf',
  'fileMove',
  'dbQuery',
  'dbExecute',
  'dbExport',
  'apiGet',
  'apiPost',
  'apiJsonParse',
]);

function isPluginAction(action: WorkflowAction): boolean {
  return PLUGIN_ACTION_TYPES.has(action.type);
}

function isBatchAction(action: WorkflowAction): boolean {
  return action.type.startsWith('batch');
}

// Plain `input` steps (via Add → Type text, or typed on the page) get the
// same expandable panel batch nodes do, just to edit the one field they have.
// `click` and `hover` get one too, for the "optional" toggle below.
function isConfigurable(action: WorkflowAction): boolean {
  return (
    isBatchAction(action) ||
    isPluginAction(action) ||
    action.type === 'input' ||
    action.type === 'click' ||
    action.type === 'hover'
  );
}

function isOptional(action: WorkflowAction): boolean {
  return action.onError === 'skip' || action.onError === 'ignore';
}

// Uncontrolled against the parent's state so a keystroke doesn't wait on the
// UPDATE_ACTION round trip before it shows up — only the commit does.
function NoteField({ value, onCommit }: { value: string; onCommit: (next: string) => void }) {
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  return (
    <input
      className="action-note"
      type="text"
      placeholder="Add a note…"
      value={draft}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
    />
  );
}

interface Props {
  recording: boolean;
  actions: WorkflowAction[];
  error: string | null;
  datasetHeaders: string[];
  thumbnails: Record<string, string>;
  onToggleRecording: () => void;
  onRemoveAction: (index: number) => void;
  onUpdateAction: (index: number, patch: Record<string, unknown>) => void;
  onAddAction: (action: RecordedActionPayload) => void;
  onReset: () => void;
}

export function RecordTab({
  recording,
  actions,
  error,
  datasetHeaders,
  thumbnails,
  onToggleRecording,
  onRemoveAction,
  onUpdateAction,
  onAddAction,
  onReset,
}: Props) {
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // The freshest configurable node is the one the user just recorded and has
  // yet to fill in (a value, a column, an output name, ...) — open it
  // automatically.
  useEffect(() => {
    const last = actions[actions.length - 1];
    if (last && isConfigurable(last)) setExpandedId(last.id);
  }, [actions.length]);

  // an armed Reset should not stay armed forever waiting for a stray click
  useEffect(() => {
    if (!confirmingReset) return;
    const timer = window.setTimeout(() => setConfirmingReset(false), CONFIRM_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [confirmingReset]);

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
          💡 <strong>Ctrl+Right-click</strong> anything on the page to capture it as table data, a text value, an
          image, or text to type in.
        </div>
      )}

      <div className="actions-toolbar">
        <span>
          {actions.length} action{actions.length === 1 ? '' : 's'}
        </span>
        <div className="actions-toolbar-right">
          <AddStepMenu onAdd={onAddAction} />
          {confirmingReset ? (
            <span className="reset-confirm">
              Discard {actions.length}?
              <button
                className="reset-btn danger"
                onClick={() => {
                  setConfirmingReset(false);
                  onReset();
                }}
              >
                Yes
              </button>
              <button className="reset-btn" onClick={() => setConfirmingReset(false)}>
                No
              </button>
            </span>
          ) : (
            <button className="reset-btn" disabled={actions.length === 0} onClick={() => setConfirmingReset(true)}>
              ↺ Reset
            </button>
          )}
        </div>
      </div>

      {actions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">✨</div>
          <strong>No actions yet</strong>
          <p>Click Start, then interact with the page.</p>
        </div>
      ) : (
        <div className="actions-list">
          {actions.map((action, index) => {
            const batch = isBatchAction(action);
            const configurable = isConfigurable(action);
            const expanded = configurable && expandedId === action.id;

            return (
              <div className="action-item" key={action.id}>
                <div className="action-row">
                  <div className="action-step">{index + 1}</div>
                  <ActionThumb dataUrl={thumbnails[action.id]} />
                  <div
                    className="action-info"
                    onClick={configurable ? () => setExpandedId(expanded ? null : action.id) : undefined}
                  >
                    <div className="action-type-line">
                      <span className="action-icon">{actionTypeIcon(action.type)}</span>
                      <div className="action-type" data-type={action.type}>
                        {batch ? batchNodeLabel(actions, index) : action.type}
                      </div>
                      {isOptional(action) && (
                        <span className="action-optional-badge" title="Skipped if not found on the page">
                          optional
                        </span>
                      )}
                      {isCliOnlyAction(action.type) && (
                        <span
                          className="action-optional-badge"
                          title="Runs via the CLI/scheduled export only — Preview in this popup skips it"
                        >
                          CLI only
                        </span>
                      )}
                    </div>
                    <div className="action-selector">{actionSelectorText(action)}</div>
                    {actionValueText(action) && <div className="action-value">{actionValueText(action)}</div>}
                  </div>
                  <button className="action-delete" onClick={() => onRemoveAction(index)}>
                    ✕
                  </button>
                </div>

                <NoteField
                  value={action.note ?? ''}
                  onCommit={(note) => onUpdateAction(index, { note: note || undefined })}
                />

                {expanded && batch && (
                  <BatchNodeConfig
                    action={action}
                    datasetHeaders={datasetHeaders}
                    onUpdate={(patch) => onUpdateAction(index, patch)}
                  />
                )}
                {expanded && isPluginAction(action) && (
                  <PluginActionConfig action={action} onUpdate={(patch) => onUpdateAction(index, patch)} />
                )}
                {expanded && action.type === 'input' && (
                  <div className="action-batch-config">
                    <label>
                      Value
                      <input
                        type="text"
                        value={action.value}
                        onChange={(e) => onUpdateAction(index, { value: e.target.value })}
                      />
                    </label>
                  </div>
                )}
                {expanded && (action.type === 'click' || action.type === 'hover') && (
                  <div className="action-batch-config">
                    <label className="action-optional-toggle">
                      <input
                        type="checkbox"
                        checked={isOptional(action)}
                        onChange={(e) => onUpdateAction(index, { onError: e.target.checked ? 'skip' : undefined })}
                      />
                      Optional — {action.type === 'hover' ? 'hover' : 'click'} if present, skip if not (e.g. a
                      popup that doesn't always appear)
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
