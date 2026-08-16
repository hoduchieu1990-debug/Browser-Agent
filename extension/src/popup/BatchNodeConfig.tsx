import type { WorkflowAction, BatchInputType, BatchExtractType, BatchReplaceMode } from '../types';

interface Props {
  action: WorkflowAction;
  datasetHeaders: string[];
  onUpdate: (patch: Record<string, unknown>) => void;
}

const INPUT_TYPES: { value: BatchInputType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'select', label: 'Select' },
  { value: 'fileUpload', label: 'File Upload' },
];

const REPLACE_MODES: { value: BatchReplaceMode; label: string }[] = [
  { value: 'replace', label: 'Replace' },
  { value: 'append', label: 'Append' },
  { value: 'keepExisting', label: 'Keep Existing' },
];

const EXTRACT_TYPES: { value: BatchExtractType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'attribute', label: 'Attribute' },
  { value: 'value', label: 'Value' },
];

// The one config panel every batch node type shares — Column/Input Type for
// Input, Timeout for Search, Extract Type/Output for Extract. Click needs
// nothing beyond the selector the badge already captured.
export function BatchNodeConfig({ action, datasetHeaders, onUpdate }: Props) {
  if (action.type === 'batchInput') {
    return (
      <div className="action-batch-config">
        <label>
          Column
          <select value={action.column} onChange={(e) => onUpdate({ column: e.target.value })}>
            <option value="">{datasetHeaders.length ? 'Choose a column…' : 'Attach a dataset first'}</option>
            {datasetHeaders.map((header) => (
              <option key={header} value={header}>
                {header}
              </option>
            ))}
          </select>
        </label>
        <label>
          Input Type
          <select value={action.inputType} onChange={(e) => onUpdate({ inputType: e.target.value as BatchInputType })}>
            {INPUT_TYPES.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Before Input
          <select
            value={action.replaceMode ?? 'replace'}
            onChange={(e) => onUpdate({ replaceMode: e.target.value as BatchReplaceMode })}
          >
            {REPLACE_MODES.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    );
  }

  if (action.type === 'batchSearch') {
    return (
      <div className="action-batch-config">
        <label>
          Wait Condition
          <select value="elementAppears" disabled>
            <option value="elementAppears">Element appears</option>
          </select>
        </label>
        <label>
          Timeout (s)
          <input
            type="number"
            min={1}
            value={action.waitCondition.timeout / 1000}
            onChange={(e) =>
              onUpdate({ waitCondition: { ...action.waitCondition, timeout: Number(e.target.value) * 1000 } })
            }
          />
        </label>
      </div>
    );
  }

  if (action.type === 'batchExtract') {
    return (
      <div className="action-batch-config">
        <label>
          Extract Type
          <select
            value={action.extractType}
            onChange={(e) => onUpdate({ extractType: e.target.value as BatchExtractType })}
          >
            {EXTRACT_TYPES.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        {action.extractType === 'attribute' && (
          <label>
            Attribute name
            <input type="text" value={action.attribute ?? ''} onChange={(e) => onUpdate({ attribute: e.target.value })} />
          </label>
        )}
        <label>
          Output Name
          <input type="text" value={action.output} onChange={(e) => onUpdate({ output: e.target.value })} />
        </label>
      </div>
    );
  }

  return null;
}
