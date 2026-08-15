import type { WorkflowAction, ReplayState, ReplayStepLog } from '../types';

interface Props {
  actions: WorkflowAction[];
  state: ReplayState | null;
  background: boolean;
  onBackgroundChange: (value: boolean) => void;
  onReplay: () => void;
}

const STATUS_ICON: Record<ReplayStepLog['status'], string> = {
  running: '⏳',
  done: '✓',
  skipped: '⊘',
  failed: '✕',
};

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

function StepLog({ steps, total }: { steps: ReplayStepLog[]; total: number }) {
  return (
    <div className="step-log">
      {steps.map((step) => (
        <div className={`step-row step-${step.status}`} key={step.index}>
          <span className="step-icon">{STATUS_ICON[step.status]}</span>
          <span className="step-index">
            {step.index}/{total}
          </span>
          <span className="step-body">
            <span className="step-type">{step.type}</span>
            {step.target && <span className="step-target">{step.target}</span>}
            {step.message && <span className="step-message">{step.message}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

export function PreviewTab({ actions, state, background, onBackgroundChange, onReplay }: Props) {
  const running = state?.running ?? false;
  const variables = state?.variables ?? {};
  const extractCount = actions.filter((a) => a.type.startsWith('extract')).length;
  const currentStep = state?.steps.find((s) => s.status === 'running');

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

      {state && state.steps.length > 0 && <StepLog steps={state.steps} total={state.total} />}

      {Object.entries(variables).map(([name, value]) => (
        <DataView key={name} name={name} value={value} />
      ))}

      {state && !running && !state.error && Object.keys(variables).length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <strong>Replay finished — no data captured</strong>
          <p>Hover a table or value while recording and press ＋ Add.</p>
        </div>
      )}

      {!state && (
        <div className="empty-state">
          <div className="empty-state-icon">✨</div>
          <strong>Review your recording</strong>
          <p>Replay the steps in this tab and see the data they capture.</p>
        </div>
      )}
    </div>
  );
}
