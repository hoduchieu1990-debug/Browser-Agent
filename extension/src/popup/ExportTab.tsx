import { useState } from 'react';
import type { WorkflowAction, RecorderSettings, SavedRecording } from '../types';
import { buildWorkflow } from '../utils/workflow-builder';

interface Props {
  actions: WorkflowAction[];
  recordings: SavedRecording[];
  settings: RecorderSettings;
}

const CURRENT = 'current';

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workflow';
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

// Recordings from the same site share a name and often a timestamp minute, so
// the list has to say what each one actually captures to be pickable.
function describeCaptures(actions: WorkflowAction[]): string {
  const counts = { table: 0, text: 0, image: 0 };
  for (const action of actions) {
    if (action.type === 'extractTable') counts.table++;
    else if (action.type === 'extractText') counts.text++;
    else if (action.type === 'screenshot') counts.image++;
  }

  const parts: string[] = [];
  if (counts.table) parts.push(`${counts.table} table${counts.table > 1 ? 's' : ''}`);
  if (counts.text) parts.push(`${counts.text} text`);
  if (counts.image) parts.push(`${counts.image} image${counts.image > 1 ? 's' : ''}`);
  return parts.join(', ') || 'no captures';
}

export function ExportTab({ actions, recordings, settings }: Props) {
  const [selectedId, setSelectedId] = useState<string>(CURRENT);
  const [name, setName] = useState('my-workflow');
  const [description, setDescription] = useState('');

  const selected = recordings.find((r) => r.id === selectedId);
  const exportActions = selectedId === CURRENT ? actions : (selected?.actions ?? []);

  const select = (id: string, defaultName: string) => {
    setSelectedId(id);
    setName(slugify(defaultName));
  };

  const handleExport = () => {
    const workflow = buildWorkflow(exportActions, name, description, settings);
    const blob = new Blob([JSON.stringify(workflow, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: `${name || 'workflow'}.json` });
  };

  return (
    <div className="export-form">
      <div className="form-group">
        <label className="form-label">Job to export</label>
        <div className="job-list">
          <button
            className={selectedId === CURRENT ? 'job-item selected' : 'job-item'}
            onClick={() => select(CURRENT, 'my-workflow')}
          >
            <span className="job-name">Current recording</span>
            <span className="job-meta">
              {actions.length} action{actions.length === 1 ? '' : 's'} · {describeCaptures(actions)}
            </span>
          </button>

          {recordings.map((recording) => (
            <button
              key={recording.id}
              className={selectedId === recording.id ? 'job-item selected' : 'job-item'}
              onClick={() => select(recording.id, recording.name)}
            >
              <span className="job-name">{recording.name}</span>
              <span className="job-meta">{formatTime(recording.createdAt)}</span>
              <span className="job-meta">
                {recording.actions.length} action{recording.actions.length === 1 ? '' : 's'} ·{' '}
                {describeCaptures(recording.actions)}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Workflow Name</label>
        <input
          className="form-input"
          type="text"
          placeholder="e.g., upload-data"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="form-group">
        <label className="form-label">Description</label>
        <input
          className="form-input"
          type="text"
          placeholder="What this workflow does"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <p className="form-hint">
        Exports as browser-agent workflow JSON — run it with <code>browser-agent run {name || 'workflow'}.json</code>
      </p>

      <button className="export-btn" disabled={exportActions.length === 0} onClick={handleExport}>
        📥 Export {exportActions.length} action{exportActions.length === 1 ? '' : 's'}
      </button>
    </div>
  );
}
