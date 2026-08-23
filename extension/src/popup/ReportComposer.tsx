import { useState } from 'react';
// A direct subpath import, not the `@browser-agent/shared` barrel — the
// barrel's index.ts re-exports utils.ts, which runs `ajv.compile()` at
// module load (top-level `new Function` under the hood), and MV3's default
// CSP (script-src 'self') rejects that the instant the popup bundle loads.
// report-email.ts has no other runtime imports, so this subpath alone.
import { buildReportEmail } from '@browser-agent/shared/dist/report-email';
import type {
  SavedRecording,
  RecorderSettings,
  EmailSettings,
  ScheduleConfig,
  ScheduleRecurrence,
  ScheduleAttachment,
  ReportBatchResult,
} from '../types';
import { buildWorkflow } from '../utils/workflow-builder';
import { extractableOutputs } from '../utils/result-keys';

interface Props {
  recording: SavedRecording;
  settings: RecorderSettings;
  emailSettings: EmailSettings;
  onAddRecipient: (email: string) => void;
}

type TabKey = 'schedule' | 'content' | 'format' | 'review';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'schedule', label: 'Schedule' },
  { key: 'content', label: 'Content' },
  { key: 'format', label: 'Format' },
  { key: 'review', label: 'Review' },
];

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

export function ReportComposer({ recording, settings, emailSettings, onAddRecipient }: Props) {
  const outputs = extractableOutputs(recording.actions);

  const [tab, setTab] = useState<TabKey>('schedule');

  const [selectedRecipients, setSelectedRecipients] = useState<Set<string>>(new Set());
  const [newRecipient, setNewRecipient] = useState('');
  const [subject, setSubject] = useState('');

  const [name, setName] = useState(recording.name);
  const [recurrenceType, setRecurrenceType] = useState<'once' | 'weekly'>('weekly');
  const [date, setDate] = useState(todayIso());
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set());
  // Each entry is its own independent trigger during the day — "08:00,
  // 12:00, 17:00" runs (and emails) three separate times, not one run
  // repeated three times back to back.
  const [times, setTimes] = useState<string[]>(['09:00']);
  const [newTime, setNewTime] = useState('09:00');

  const [content, setContent] = useState('');

  const [resultKeys, setResultKeys] = useState<Set<string>>(new Set(outputs));
  const [attachEnabled, setAttachEnabled] = useState(false);
  const [attachFormat, setAttachFormat] = useState<'csv' | 'excel'>('csv');

  const addRecipient = () => {
    const email = newRecipient.trim();
    if (!email) return;
    onAddRecipient(email);
    setSelectedRecipients(toggleInSet(selectedRecipients, email));
    setNewRecipient('');
  };

  const addTime = () => {
    if (!newTime || times.includes(newTime)) return;
    setTimes([...times, newTime].sort());
  };

  const removeTime = (time: string) => {
    setTimes(times.filter((t) => t !== time));
  };

  const hasEmailAccount = emailSettings.user.trim() !== '';
  const hasRecurrenceDay = recurrenceType === 'once' ? !!date : weekdays.size > 0;
  const hasTimes = times.length > 0;

  const missing: string[] = [];
  if (name.trim() === '') missing.push('a report name');
  if (!hasRecurrenceDay) missing.push(recurrenceType === 'once' ? 'a date' : 'at least one day');
  if (!hasTimes) missing.push('at least one time');
  if (!hasEmailAccount) missing.push('an email account (set up in Settings)');
  if (selectedRecipients.size === 0) missing.push('at least one recipient');

  const canSubmit = missing.length === 0;

  function buildConfig(): ScheduleConfig {
    const recurrence: ScheduleRecurrence =
      recurrenceType === 'once' ? { type: 'once', date, times } : { type: 'weekly', weekdays: [...weekdays], times };

    const attachment: ScheduleAttachment | undefined = attachEnabled ? { format: attachFormat } : undefined;
    const ext = attachFormat === 'excel' ? 'xlsx' : 'csv';
    const workflow = buildWorkflow(recording.actions, name, '', settings);
    if (attachment) {
      // What makes runBatch (player/src/batch.ts) actually produce the file
      // the CLI daemon attaches — no other wiring needed there.
      workflow.exportFormats = [...resultKeys].map((key) => ({
        type: attachment.format,
        output: `${key}.${ext}`,
        dataKey: key,
      }));
    }

    return {
      id: `sched-${Date.now()}`,
      name,
      workflow,
      recurrence,
      resultKeys: [...resultKeys],
      content: content || undefined,
      attachment,
      email: {
        host: emailSettings.host,
        port: emailSettings.port,
        secure: emailSettings.secure,
        user: emailSettings.user || undefined,
        pass: emailSettings.pass || undefined,
        from: emailSettings.from || undefined,
        to: [...selectedRecipients].join(', '),
        subject: subject || undefined,
      },
      state: { timesTriggered: 0 },
    };
  }

  const handleSubmit = () => {
    if (!canSubmit) return;
    const config = buildConfig();

    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    // Same folder name the CLI's `browser-agent schedule run/list` defaults
    // to (cli/src/commands/schedule.ts) — kept in sync manually, there's no
    // shared code path between this bundle and the CLI to enforce it.
    // download() is async — closing the window right away (before Chrome has
    // actually started reading the blob: URL) can tear down this page's
    // context, and the blob URL along with it, before the download completes.
    // Closing only inside the callback, once the browser confirms it has
    // begun, is what makes it reliable.
    chrome.downloads.download(
      { url, filename: `BrowserAgent-Schedules/${config.id}.schedule.json`, saveAs: false },
      () => window.close(),
    );
  };

  const previewConfig = buildConfig();
  const placeholderBatch: ReportBatchResult = {
    rows: [{ index: 1, success: true }],
    data: Object.fromEntries([...resultKeys].map((key) => [key, [{ [key]: '(sample value)' }]])),
    files: {},
  };
  const preview = buildReportEmail(previewConfig, placeholderBatch);

  return (
    <div className="report-composer">
      <div className="report-header">
        <div className="form-group">
          <label className="form-label">To</label>
          {emailSettings.recipients.length > 0 && (
            <div className="result-key-list">
              {emailSettings.recipients.map((email) => (
                <label className="result-key-item" key={email}>
                  <input
                    type="checkbox"
                    checked={selectedRecipients.has(email)}
                    onChange={() => setSelectedRecipients(toggleInSet(selectedRecipients, email))}
                  />
                  {email}
                </label>
              ))}
            </div>
          )}
          <div className="recipient-add-row">
            <input
              className="form-input"
              type="text"
              placeholder="Add a new recipient…"
              value={newRecipient}
              onChange={(e) => setNewRecipient(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addRecipient();
                }
              }}
            />
            <button className="saved-load" onClick={addRecipient}>
              + Add
            </button>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Subject</label>
          <input className="form-input" type="text" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
      </div>

      {!hasEmailAccount && (
        <p className="form-hint schedule-warning">
          No email account set up yet — add one once in the <strong>Settings</strong> tab.
        </p>
      )}

      <div className="report-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? 'report-tab selected' : 'report-tab'}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="report-tab-body">
        {tab === 'schedule' && (
          <>
            <p className="form-hint">
              This snapshots the job as it is right now — editing the saved recording later won't change reports
              already created from it.
            </p>

            <div className="form-group">
              <label className="form-label">Report name</label>
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
              <label className="form-label">Times of day (each one runs and emails independently)</label>
              {times.length > 0 && (
                <div className="weekday-picker">
                  {times.map((t) => (
                    <span key={t} className="report-attachment-chip">
                      {t}
                      <button className="time-remove-btn" onClick={() => removeTime(t)}>
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="recipient-add-row">
                <input
                  className="form-input"
                  type="time"
                  value={newTime}
                  onChange={(e) => setNewTime(e.target.value)}
                />
                <button className="saved-load" onClick={addTime}>
                  + Add time
                </button>
              </div>
            </div>
          </>
        )}

        {tab === 'content' && (
          <div className="form-group">
            <label className="form-label">Message</label>
            <textarea
              className="form-input report-content-textarea"
              placeholder="A short note to include before the results…"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
            />
          </div>
        )}

        {tab === 'format' && (
          <>
            <div className="form-group">
              <label className="form-label">Results to include</label>
              {outputs.length === 0 ? (
                <p className="form-hint">This job has no extractText/extractTable/extractJson steps, so there's nothing to report.</p>
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
              <label className="result-key-item">
                <input type="checkbox" checked={attachEnabled} onChange={(e) => setAttachEnabled(e.target.checked)} />
                Attach results as a file
              </label>
              {attachEnabled && (
                <div className="recurrence-type-picker">
                  <button
                    className={attachFormat === 'csv' ? 'recurrence-type-btn selected' : 'recurrence-type-btn'}
                    onClick={() => setAttachFormat('csv')}
                  >
                    CSV
                  </button>
                  <button
                    className={attachFormat === 'excel' ? 'recurrence-type-btn selected' : 'recurrence-type-btn'}
                    onClick={() => setAttachFormat('excel')}
                  >
                    Excel
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'review' && (
          <>
            <p className="form-hint">Sample data — actual runs will fill in real values.</p>
            <div className="report-preview-headers">
              <div><strong>From:</strong> {preview.from || '(SMTP account, set in Settings)'}</div>
              <div><strong>To:</strong> {preview.to || '(no recipient selected)'}</div>
              <div><strong>Subject:</strong> {preview.subject}</div>
            </div>
            <iframe className="report-preview-frame" srcDoc={preview.html} sandbox="" title="Email preview" />
            {preview.attachments && preview.attachments.length > 0 && (
              <div className="result-key-list">
                {preview.attachments.map((a) => (
                  <span key={a.filename} className="report-attachment-chip">
                    📎 {a.filename}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {!canSubmit && (
        <p className="form-hint schedule-warning">Still needed: {missing.join(', ')}.</p>
      )}
      <div className="schedule-form-actions">
        <button className="action-delete schedule-cancel-btn" onClick={() => window.close()}>
          Cancel
        </button>
        <button className="export-btn" disabled={!canSubmit} onClick={handleSubmit}>
          📥 Create report
        </button>
      </div>
    </div>
  );
}
