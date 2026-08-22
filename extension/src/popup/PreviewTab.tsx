import type { WorkflowAction, ReplayState, ReplayStepLog } from '../types';
import { actionSelectorText, actionTypeIcon } from '../utils/action-display';
import { ActionThumb } from './ActionThumb';

interface Props {
  actions: WorkflowAction[];
  state: ReplayState | null;
  background: boolean;
  thumbnails: Record<string, string>;
  onBackgroundChange: (value: boolean) => void;
  onReplay: () => void;
}

const STATUS_ICON: Record<ReplayStepLog['status'], string> = {
  running: '⏳',
  done: '✓',
  skipped: '⊘',
  failed: '✕',
};

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function isTableData(value: unknown): value is Record<string, string>[] {
  return Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && value[0] !== null;
}

function isImage(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:image/');
}

function DataView({ name, value }: { name: string; value: unknown }) {
  return (
    <div className="result-block">
      <div className="result-name">{name}</div>
      {isImage(value) ? (
        <div className="result-image-wrap">
          <img className="result-image" src={value} alt={name} />
        </div>
      ) : isTableData(value) ? (
        <div className="result-table-wrap">
          <table className="result-table">
            <thead>
              <tr>
                {Object.keys(value[0]).map((key) => (
                  <th key={key}>{key}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {value.map((row, i) => (
                <tr key={i}>
                  {Object.keys(value[0]).map((key) => (
                    <td key={key}>{row[key]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="result-meta">{value.length} rows</div>
        </div>
      ) : (
        <div className="result-value">{typeof value === 'string' ? value : JSON.stringify(value)}</div>
      )}
    </div>
  );
}

// The order captures come back in is not the order they were recorded in, so
// follow the workflow itself and let the results read top-to-bottom the way
// the steps do.
function capturedInStepOrder(actions: WorkflowAction[], variables: Record<string, unknown>): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();

  for (const action of actions) {
    const name = 'output' in action ? action.output : undefined;
    if (name && name in variables && !seen.has(name)) {
      ordered.push(name);
      seen.add(name);
    }
  }

  // anything captured that no step claims still deserves to be shown
  for (const name of Object.keys(variables)) if (!seen.has(name)) ordered.push(name);

  return ordered;
}

// Before Replay has ever run (or after the recording changed since it last
// did), there is no ReplayStepLog yet — this shows what WOULD run, using the
// current recording directly, so Preview never has to fall back to showing
// a stale run's steps just because a fresh one hasn't happened yet.
function PendingStepLog({ actions, thumbnails }: { actions: WorkflowAction[]; thumbnails: Record<string, string> }) {
  return (
    <div className="step-log">
      {actions.map((action, i) => (
        <div className="step-row" key={action.id}>
          <span className="step-icon">•</span>
          <span className="step-index">
            {i + 1}/{actions.length}
          </span>
          <ActionThumb dataUrl={thumbnails[action.id]} />
          <span className="step-body">
            <span className="step-type-line">
              <span className="action-icon">{actionTypeIcon(action.type)}</span>
              <span className="step-type action-type" data-type={action.type}>
                {action.type}
              </span>
            </span>
            {actionSelectorText(action) && <span className="step-target">{actionSelectorText(action)}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

// state.steps' own index is 1-based into the same `actions` array the recorder
// produced (see runReplay in background.ts), so that is also the key back to
// this step's thumbnail — ReplayStepLog itself never carries an action id.
function StepLog({
  steps,
  total,
  actions,
  thumbnails,
}: {
  steps: ReplayStepLog[];
  total: number;
  actions: WorkflowAction[];
  thumbnails: Record<string, string>;
}) {
  return (
    <div className="step-log">
      {steps.map((step) => (
        <div className={`step-row step-${step.status}`} key={step.index}>
          <span className="step-icon">{STATUS_ICON[step.status]}</span>
          <span className="step-index">
            {step.index}/{total}
          </span>
          <ActionThumb dataUrl={thumbnails[actions[step.index - 1]?.id]} />
          <span className="step-body">
            <span className="step-type-line">
              <span className="action-icon">{actionTypeIcon(step.type)}</span>
              <span className="step-type action-type" data-type={step.type}>
                {step.type}
              </span>
            </span>
            {step.target && <span className="step-target">{step.target}</span>}
            {step.message && <span className="step-message">{step.message}</span>}
          </span>
          {step.durationMs !== undefined && <span className="step-duration">{formatDuration(step.durationMs)}</span>}
        </div>
      ))}
    </div>
  );
}

export function PreviewTab({ actions, state, background, thumbnails, onBackgroundChange, onReplay }: Props) {
  const running = state?.running ?? false;
  const variables = state?.variables ?? {};
  const extractCount = actions.filter((a) => a.type.startsWith('extract')).length;
  const currentStep = state?.steps.find((s) => s.status === 'running');
  const capturedNames = capturedInStepOrder(actions, variables);
  const totalDurationMs = state && !running ? state.updatedAt - state.startedAt : null;

  return (
    <div>
      <button className="replay-btn" disabled={actions.length === 0 || running} onClick={onReplay}>
        {running ? '⏳ Replaying…' : '▶ Replay & show data'}
      </button>

      <label className="replay-option">
        <input
          type="checkbox"
          checked={background}
          disabled={running}
          onChange={(e) => onBackgroundChange(e.target.checked)}
        />
        <span>
          Run in background
          <span className="replay-option-hint">minimized window — never opens in front of you</span>
        </span>
      </label>

      <div className="replay-status">
        {running && currentStep
          ? `Running step ${currentStep.index} of ${state?.total}: ${currentStep.type}`
          : `${actions.length} action${actions.length === 1 ? '' : 's'} · ${extractCount} extraction${extractCount === 1 ? '' : 's'}`}
      </div>

      {state?.error && <div className="error-banner">⚠️ {state.error}</div>}

      {state && state.steps.length > 0 ? (
        <section className="panel">
          <h3 className="panel-title">
            Steps
            <span className="panel-count">
              {state.steps.filter((s) => s.status !== 'running').length}/{state.total}
            </span>
            {totalDurationMs !== null && (
              <span className="panel-duration">⏱ {formatDuration(totalDurationMs)} total</span>
            )}
          </h3>
          <StepLog steps={state.steps} total={state.total} actions={actions} thumbnails={thumbnails} />
        </section>
      ) : (
        !state &&
        actions.length > 0 && (
          <section className="panel">
            <h3 className="panel-title">
              Steps
              <span className="panel-count">{actions.length}</span>
            </h3>
            <PendingStepLog actions={actions} thumbnails={thumbnails} />
          </section>
        )
      )}

      {capturedNames.length > 0 && (
        <section className="panel panel-results">
          <h3 className="panel-title">
            Result Data
            <span className="panel-count">{capturedNames.length}</span>
          </h3>
          <div className="panel-body">
            {capturedNames.map((name) => (
              <DataView key={name} name={name} value={variables[name]} />
            ))}
          </div>
        </section>
      )}

      {state && !running && !state.error && Object.keys(variables).length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <strong>Replay finished — no data captured</strong>
          <p>Hover a table or value while recording and press ＋ Add.</p>
        </div>
      )}

      {!state && actions.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">✨</div>
          <strong>Nothing recorded yet</strong>
          <p>Record some steps, then come back here to replay them.</p>
        </div>
      )}
    </div>
  );
}
