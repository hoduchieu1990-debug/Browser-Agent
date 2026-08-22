import { useState } from 'react';
import type { SavedRecording, RecorderSettings, ScheduleConfig, ScheduleRecurrence } from '../types';
import { buildWorkflow } from '../utils/workflow-builder';
import { extractableOutputs } from '../utils/result-keys';

interface Props {
  recording: SavedRecording;
  settings: RecorderSettings;
  onClose: () => void;
}

const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function ScheduleForm({ recording, settings, onClose }: Props) {
  const outputs = extractableOutputs(recording.actions);

  const [name, setName] = useState(recording.name);
  const [recurrenceType, setRecurrenceType] = useState<'once' | 'weekly'>('weekly');
  const [date, setDate] = useState(todayIso());
  const [time, setTime] = useState('09:00');
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set());
  const [repeatCount, setRepeatCount] = useState(1);
  const [resultKeys, setResultKeys] = useState<Set<string>>(new Set(outputs));

  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState(25);
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');

  const [saved, setSaved] = useState(false);

  const recurrenceValid = recurrenceType === 'once' ? !!date : weekdays.size > 0;
  const canSubmit = name.trim() !== '' && recurrenceValid && repeatCount >= 1 && smtpHost.trim() !== '' && emailTo.trim() !== '';

  const handleSubmit = () => {
    if (!canSubmit) return;

    const recurrence: ScheduleRecurrence =
      recurrenceType === 'once' ? { type: 'once', date, time } : { type: 'weekly', weekdays: [...weekdays], time };

    const workflow = buildWorkflow(recording.actions, name, '', settings);
    const config: ScheduleConfig = {
      id: `sched-${Date.now()}`,
      name,
      workflow,
      recurrence,
      repeatCount,
      resultKeys: [...resultKeys],
      stopOnError: true,
      email: {
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        user: smtpUser || undefined,
        pass: smtpPass || undefined,
        to: emailTo,
        subject: emailSubject || undefined,
      },
      state: { timesTriggered: 0 },
    };

    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    // Same folder name the CLI's `browser-agent schedule run/list` defaults
    // to (cli/src/commands/schedule.ts) — kept in sync manually, there's no
    // shared code path between this bundle and the CLI to enforce it.
    chrome.downloads.download({ url, filename: `BrowserAgent-Schedules/${config.id}.schedule.json`, saveAs: false });
    setSaved(true);
  };

  if (saved) {
    return (
      <div className="schedule-panel">
        <p className="form-hint">
          Schedule saved to <code>Downloads/BrowserAgent-Schedules/</code>. After the one-time background-daemon
          setup (see the CLI docs), it'll run automatically — nothing else to open.
        </p>
        <button className="export-btn" onClick={onClose}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="schedule-panel">
      <p className="form-hint">
        This snapshots the job as it is right now — editing the saved recording later won't change schedules already
        created from it.
      </p>

      <div className="form-group">
        <label className="form-label">Schedule name</label>
        <input className="form-input" type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="form-group">
        <label className="form-label">Recurrence</label>
        <div className="recurrence-type-picker">
          <button
            className={recurrenceType === 'weekly' ? 'recurrence-type-btn selected' : 'recurrence-type-btn'}
            onClick={() => setRecurrenceType('weekly')}
          >
            Weekly
          </button>
          <button
            className={recurrenceType === 'once' ? 'recurrence-type-btn selected' : 'recurrence-type-btn'}
            onClick={() => setRecurrenceType('once')}
          >
            Once on a date
          </button>
        </div>
      </div>

      {recurrenceType === 'weekly' ? (
        <div className="form-group">
          <label className="form-label">Days</label>
          <div className="weekday-picker">
            {WEEKDAYS.map((day) => (
              <button
                key={day.value}
                className={weekdays.has(day.value) ? 'weekday-chip selected' : 'weekday-chip'}
                onClick={() => setWeekdays(toggleInSet(weekdays, day.value))}
              >
                {day.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="form-group">
          <label className="form-label">Date</label>
          <input className="form-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      )}

      <div className="form-group">
        <label className="form-label">Time</label>
        <input className="form-input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </div>

      <div className="form-group">
        <label className="form-label">Repeat count (runs each time it fires)</label>
        <input
          className="form-input"
          type="number"
          min={1}
          value={repeatCount}
          onChange={(e) => setRepeatCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
        />
      </div>

      <div className="form-group">
        <label className="form-label">Results to email</label>
        {outputs.length === 0 ? (
          <p className="form-hint">This job has no extractText/extractTable/extractJson steps, so there's nothing to email.</p>
        ) : (
          <div className="result-key-list">
            {outputs.map((key) => (
              <label className="result-key-item" key={key}>
                <input
                  type="checkbox"
                  checked={resultKeys.has(key)}
                  onChange={() => setResultKeys(toggleInSet(resultKeys, key))}
                />
                {key}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="form-group">
        <label className="form-label">SMTP host</label>
        <input
          className="form-input"
          type="text"
          placeholder="smtp.samsung.net"
          value={smtpHost}
          onChange={(e) => setSmtpHost(e.target.value)}
        />
      </div>

      <div className="smtp-row">
        <div className="form-group">
          <label className="form-label">Port</label>
          <input
            className="form-input"
            type="number"
            value={smtpPort}
            onChange={(e) => setSmtpPort(parseInt(e.target.value, 10) || 25)}
          />
        </div>
        <label className="result-key-item smtp-secure-toggle">
          <input type="checkbox" checked={smtpSecure} onChange={(e) => setSmtpSecure(e.target.checked)} />
          Secure (TLS)
        </label>
      </div>

      <div className="form-group">
        <label className="form-label">SMTP user (optional)</label>
        <input className="form-input" type="text" value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} />
      </div>

      <div className="form-group">
        <label className="form-label">SMTP password (optional)</label>
        <input className="form-input" type="password" value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} />
      </div>

      <div className="form-group">
        <label className="form-label">Send report to</label>
        <input
          className="form-input"
          type="text"
          placeholder="you@company.com"
          value={emailTo}
          onChange={(e) => setEmailTo(e.target.value)}
        />
      </div>

      <div className="form-group">
        <label className="form-label">Subject (optional)</label>
        <input className="form-input" type="text" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
      </div>

      <div className="schedule-form-actions">
        <button className="action-delete schedule-cancel-btn" onClick={onClose}>
          Cancel
        </button>
        <button className="export-btn" disabled={!canSubmit} onClick={handleSubmit}>
          📥 Create schedule
        </button>
      </div>
    </div>
  );
}
