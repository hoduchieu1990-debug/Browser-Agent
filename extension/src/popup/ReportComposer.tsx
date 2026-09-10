import { useEffect, useState } from 'react';
// A direct subpath import, not the `@browser-agent/shared` barrel — the
// barrel's index.ts re-exports utils.ts, which runs `ajv.compile()` at
// module load (top-level `new Function` under the hood), and MV3's default
// CSP (script-src 'self') rejects that the instant the popup bundle loads.
// report-email.ts has no other runtime imports, so this subpath alone.
import { buildReportEmail } from '@browser-agent/shared/dist/report-email';
import { defaultReportBlocks } from '@browser-agent/shared/dist/schedule-types';
import type {
  SavedRecording,
  RecorderSettings,
  EmailSettings,
  ScheduleConfig,
  ScheduleRecurrence,
  ScheduleAttachment,
  ReportBatchResult,
  ReportBlock,
  ReportBlockType,
  ReplayState,
  RuntimeMessage,
} from '../types';
import { buildWorkflow } from '../utils/workflow-builder';
import { extractableOutputs, type ReportResultKind, type ReportResultSource } from '../utils/result-keys';

const BLOCK_LABELS: Record<Exclude<ReportBlockType, 'result'>, string> = {
  heading: '📌 Heading',
  paragraph: '📝 Paragraph',
  divider: '➖ Divider',
};

const KIND_ICON: Record<ReportResultKind, string> = { text: '🎯', table: '📊', image: '🖼️' };
const KIND_LABEL: Record<ReportResultKind, string> = { text: 'Text', table: 'Table', image: 'Image' };

interface Props {
  recording: SavedRecording;
  settings: RecorderSettings;
  emailSettings: EmailSettings;
  onAddRecipient: (email: string) => void;
}

let blockIdCounter = 0;
function newBlockId(): string {
  blockIdCounter += 1;
  return `block-${Date.now()}-${blockIdCounter}`;
}

// Reshapes a finished real run into the batch shape buildReportEmail expects —
// null while nothing has actually run yet, so the caller knows to fall back
// to sample data instead of an empty/failed-looking preview.
function toReportBatch(state: ReplayState | null, outputs: ReportResultSource[]): ReportBatchResult | null {
  if (!state || state.running) return null;
  if (state.error) return { rows: [{ index: 1, success: false, error: state.error }], data: {}, files: {} };
  const data: Record<string, unknown[]> = {};
  for (const { key } of outputs) data[key] = [{ [key]: state.variables[key] }];
  return { rows: [{ index: 1, success: true }], data, files: {} };
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

// A block dragged from the palette — before it has an id, since that's only
// assigned once it actually lands on the canvas.
type PaletteItem =
  | { kind: 'heading' | 'paragraph' | 'divider' }
  | { kind: 'result'; resultKey: string };

function blockFromPalette(item: PaletteItem): Omit<ReportBlock, 'id'> {
  if (item.kind === 'result') return { type: 'result', resultKey: item.resultKey };
  if (item.kind === 'divider') return { type: 'divider' };
  return { type: item.kind, text: '' };
}

// What the browser puts on the wire for both a palette drag (a block not on
// the canvas yet) and a canvas drag (reordering one already there) — one MIME
// type, discriminated by `kind`, so a single drop handler covers both.
type DragPayload = { kind: 'new'; item: PaletteItem } | { kind: 'move'; id: string };
const DRAG_MIME = 'application/x-ba-report-block';

export function ReportComposer({ recording, settings, emailSettings, onAddRecipient }: Props) {
  const outputs = extractableOutputs(recording.actions);
  const kindByKey = new Map(outputs.map((o) => [o.key, o.kind]));

  const [activeTab, setActiveTab] = useState<'edit' | 'review'>('edit');

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

  // The email body as a small drag-and-drop canvas: an ordered list of
  // blocks the user drags in from the palette, edits, removes, and
  // reorders — not a single free-text field. Each result the job produced
  // (text/table/image) is its own draggable palette item, so it can be
  // placed anywhere among the headings/paragraphs rather than dumped as one
  // combined block.
  const [blocks, setBlocks] = useState<ReportBlock[]>(defaultReportBlocks(outputs.map((o) => o.key)));
  // Which drop target (a block's id, or 'end' for after the last block) is
  // currently under the dragged item — purely a highlight, cleared on every
  // drop/dragleave.
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

  // Attachment is a separate concern from the canvas: which results get
  // bundled into a downloadable CSV/Excel file, independent of which ones
  // (if any) the user chose to show inline in the email body.
  const [resultKeys, setResultKeys] = useState<Set<string>>(new Set(outputs.map((o) => o.key)));
  const [attachEnabled, setAttachEnabled] = useState(false);
  const [attachFormat, setAttachFormat] = useState<'csv' | 'excel'>('csv');

  // Sample data until a real run has actually reported back (or is running) —
  // previewFetched gates the auto-run below so it never fires on the render
  // before GET_REPORT_PREVIEW_STATE's own answer (a real earlier result, or
  // truly nothing) has come back; without that gate a stale null on the
  // first render would auto-trigger a redundant run every single time.
  const [previewState, setPreviewState] = useState<ReplayState | null>(null);
  const [previewFetched, setPreviewFetched] = useState(false);

  useEffect(() => {
    // chrome.runtime.sendMessage invokes its callback with `undefined` (not
    // `null`) whenever the message port drops before a response arrives —
    // the service worker can be evicted mid-request at any time under MV3.
    // Every read past this point assumes ReplayState | null, so undefined
    // must be normalized here or a later `.running` access throws and takes
    // the whole page down with it (a blank window, no error the user can see).
    const asState = (state: ReplayState | null | undefined): ReplayState | null => state ?? null;

    chrome.runtime.sendMessage(
      { type: 'GET_REPORT_PREVIEW_STATE', recordingId: recording.id } satisfies RuntimeMessage,
      (state: ReplayState | null | undefined) => {
        setPreviewState(asState(state));
        setPreviewFetched(true);
      },
    );

    const listener = (message: RuntimeMessage) => {
      if (message.type === 'REPORT_PREVIEW_UPDATED' && message.recordingId === recording.id) {
        setPreviewState(asState(message.state));
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    // REPORT_PREVIEW_UPDATED broadcasts can be missed (this window not the
    // active one, a message dropped, ...) — polling must apply whatever it
    // reads unconditionally, or a missed final "running: false" update would
    // leave the UI stuck showing sample data forever even though the real
    // run actually finished (or failed) a while ago.
    const poll = window.setInterval(() => {
      chrome.runtime.sendMessage(
        { type: 'GET_REPORT_PREVIEW_STATE', recordingId: recording.id } satisfies RuntimeMessage,
        (state: ReplayState | null | undefined) => setPreviewState(asState(state)),
      );
    }, 1000);

    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      window.clearInterval(poll);
    };
  }, [recording.id]);

  const runRealPreview = () => {
    chrome.runtime.sendMessage({
      type: 'REPLAY_REPORT_PREVIEW',
      recordingId: recording.id,
      actions: recording.actions,
    } satisfies RuntimeMessage);
  };

  // Fires the real run the moment the window has confirmed there is no
  // earlier result already sitting in storage for this recording — the
  // whole report lives on one page now, so there is no "opening the Review
  // tab" moment to hang this on; the window opening is that moment.
  useEffect(() => {
    if (previewFetched && previewState === null) runRealPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewFetched, previewState]);

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

  const insertBlockAt = (index: number, block: ReportBlock) => {
    setBlocks((cur) => {
      const next = [...cur];
      next.splice(index, 0, block);
      return next;
    });
  };

  const moveBlockTo = (id: string, index: number) => {
    setBlocks((cur) => {
      const fromIndex = cur.findIndex((b) => b.id === id);
      if (fromIndex === -1) return cur;
      const moving = cur[fromIndex];
      const without = cur.filter((b) => b.id !== id);
      const adjusted = fromIndex < index ? index - 1 : index;
      const next = [...without];
      next.splice(adjusted, 0, moving);
      return next;
    });
  };

  // The click fallback appends to the end — dragging is how you choose
  // where, but a small popup window makes drag-precision fiddly, so a click
  // always has to work too.
  const addFromPalette = (item: PaletteItem) => {
    setBlocks((cur) => [...cur, { id: newBlockId(), ...blockFromPalette(item) }]);
  };

  const removeBlock = (id: string) => {
    setBlocks(blocks.filter((b) => b.id !== id));
  };

  const updateBlockText = (id: string, text: string) => {
    setBlocks(blocks.map((b) => (b.id === id ? { ...b, text } : b)));
  };

  const onPaletteDragStart = (e: React.DragEvent, item: PaletteItem) => {
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ kind: 'new', item } satisfies DragPayload));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const onBlockDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ kind: 'move', id } satisfies DragPayload));
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDropTargetOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === 'copy' ? 'copy' : 'move';
    setDragOverTarget(targetId);
  };

  const onDropTargetLeave = (targetId: string) => {
    setDragOverTarget((cur) => (cur === targetId ? null : cur));
  };

  // `index` is where the dropped block should land, i.e. "insert before the
  // block currently at this position" — dropping past the last block passes
  // blocks.length.
  const onDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverTarget(null);
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    const payload = JSON.parse(raw) as DragPayload;
    if (payload.kind === 'new') {
      insertBlockAt(index, { id: newBlockId(), ...blockFromPalette(payload.item) });
    } else {
      moveBlockTo(payload.id, index);
    }
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
      contentBlocks: blocks,
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
    data: Object.fromEntries(
      outputs.map(({ key, kind }) => [key, kind === 'table' ? [{ value: '(sample value)' }] : [{ [key]: '(sample value)' }]]),
    ),
    files: {},
  };
  const realBatch = toReportBatch(previewState, outputs);
  const usingRealData = realBatch !== null;
  const preview = buildReportEmail(previewConfig, realBatch ?? placeholderBatch);

  const statusLine = !previewFetched
    ? 'checking for an earlier result…'
    : previewState === null
      ? 'starting the real run…'
      : previewState.running
        ? `running… (step ${previewState.steps.length}/${previewState.total}${
            previewState.steps.length > 0 ? `, current: ${previewState.steps[previewState.steps.length - 1].type}` : ''
          })`
        : previewState.error
          ? `finished at ${new Date(previewState.updatedAt).toLocaleTimeString()} — ERROR: ${previewState.error}`
          : `finished at ${new Date(previewState.updatedAt).toLocaleTimeString()} — success, captured: ${
              Object.keys(previewState.variables).join(', ') || '(nothing)'
            }`;

  const endZoneClass =
    dragOverTarget === 'end' ? 'report-canvas-end-zone report-canvas-end-zone-over' : 'report-canvas-end-zone';

  return (
    <div className="report-composer">
      <div className="report-header">
        <div className="form-group">
          <label className="form-label">Report name</label>
          <input className="form-input" type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="form-group">
          <label className="form-label">From</label>
          <p className="form-hint report-sender-line">
            {emailSettings.from || emailSettings.user || '(set up an email account in Settings)'}
          </p>
        </div>

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
        <button
          className={activeTab === 'edit' ? 'report-tab selected' : 'report-tab'}
          onClick={() => setActiveTab('edit')}
        >
          ✏️ Edit
        </button>
        <button
          className={activeTab === 'review' ? 'report-tab selected' : 'report-tab'}
          onClick={() => setActiveTab('review')}
        >
          👁️ Review
        </button>
      </div>

      <div className="report-body">
        {activeTab === 'edit' ? (
          <>
            <section className="report-section">
              <h3 className="report-section-title">
                <span className="report-section-number">1</span> Schedule
              </h3>
              <p className="form-hint">
                This snapshots the job as it is right now — editing the saved recording later won't change reports
                already created from it.
              </p>

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
                  <input className="form-input" type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
                  <button className="saved-load" onClick={addTime}>
                    + Add time
                  </button>
                </div>
              </div>
            </section>

            <section className="report-section">
              <h3 className="report-section-title">
                <span className="report-section-number">2</span> Content canvas
              </h3>
              <p className="form-hint">
                Drag a block from the palette onto the canvas — or click one to add it to the end. Each result the job
                produced is its own block, so it can go anywhere you like.
              </p>

              <div className="report-canvas-layout">
                <div className="report-palette">
                  <div className="report-palette-label">Blocks</div>
                  {(['heading', 'paragraph', 'divider'] as const).map((type) => (
                    <div
                      key={type}
                      className="report-palette-chip"
                      draggable
                      onDragStart={(e) => onPaletteDragStart(e, { kind: type })}
                      onClick={() => addFromPalette({ kind: type })}
                      title="Drag onto the canvas, or click to add to the end"
                    >
                      {BLOCK_LABELS[type]}
                    </div>
                  ))}

                  {outputs.length > 0 && (
                    <>
                      <div className="report-palette-label report-palette-label-spaced">Results from this job</div>
                      {outputs.map(({ key, kind }) => (
                        <div
                          key={key}
                          className="report-palette-chip"
                          draggable
                          onDragStart={(e) => onPaletteDragStart(e, { kind: 'result', resultKey: key })}
                          onClick={() => addFromPalette({ kind: 'result', resultKey: key })}
                          title={`${KIND_LABEL[kind]} result — drag onto the canvas, or click to add to the end`}
                        >
                          {KIND_ICON[kind]} {key}
                        </div>
                      ))}
                    </>
                  )}
                  {outputs.length === 0 && (
                    <p className="form-hint">
                      This job has no extractText/extractTable/extractJson/screenshot steps, so there's nothing to
                      drag in yet.
                    </p>
                  )}
                </div>

                <div className="report-canvas">
                  {blocks.length === 0 && (
                    <div
                      className={dragOverTarget === 'empty' ? 'report-canvas-empty report-canvas-empty-over' : 'report-canvas-empty'}
                      onDragOver={(e) => onDropTargetOver(e, 'empty')}
                      onDragLeave={() => onDropTargetLeave('empty')}
                      onDrop={(e) => onDrop(e, 0)}
                    >
                      Drag a block here to start
                    </div>
                  )}
                  {blocks.map((block, index) => (
                    <div
                      className={dragOverTarget === block.id ? 'report-block report-block-dragover' : 'report-block'}
                      key={block.id}
                      draggable
                      onDragStart={(e) => onBlockDragStart(e, block.id)}
                      onDragOver={(e) => onDropTargetOver(e, block.id)}
                      onDragLeave={() => onDropTargetLeave(block.id)}
                      onDrop={(e) => onDrop(e, index)}
                    >
                      <div className="report-block-header">
                        <div className="report-block-label-group">
                          <span className="report-block-drag-handle" title="Drag to reorder">
                            ⠿
                          </span>
                          <span className="report-block-type" data-result-key={block.type === 'result' ? block.resultKey : undefined}>
                            {block.type === 'result'
                              ? `${KIND_ICON[kindByKey.get(block.resultKey ?? '') ?? 'text']} ${block.resultKey}`
                              : BLOCK_LABELS[block.type]}
                          </span>
                        </div>
                        <div className="report-block-controls">
                          <button className="report-block-btn" onClick={() => removeBlock(block.id)} title="Remove">
                            ✕
                          </button>
                        </div>
                      </div>
                      {block.type === 'heading' && (
                        <input
                          className="form-input"
                          type="text"
                          placeholder="Heading text…"
                          value={block.text ?? ''}
                          onChange={(e) => updateBlockText(block.id, e.target.value)}
                        />
                      )}
                      {block.type === 'paragraph' && (
                        <textarea
                          className="form-input report-content-textarea"
                          placeholder="A note, instructions, or context for the reader…"
                          value={block.text ?? ''}
                          onChange={(e) => updateBlockText(block.id, e.target.value)}
                          rows={3}
                        />
                      )}
                      {block.type === 'result' && (
                        <p className="form-hint report-result-block-hint">Filled in automatically from the run.</p>
                      )}
                    </div>
                  ))}
                  <div
                    className={endZoneClass}
                    onDragOver={(e) => onDropTargetOver(e, 'end')}
                    onDragLeave={() => onDropTargetLeave('end')}
                    onDrop={(e) => onDrop(e, blocks.length)}
                  >
                    Drop here to add to the end
                  </div>
                </div>
              </div>
            </section>

            <section className="report-section">
              <h3 className="report-section-title">
                <span className="report-section-number">3</span> Attachment
              </h3>
              <div className="form-group">
                <label className="result-key-item">
                  <input type="checkbox" checked={attachEnabled} onChange={(e) => setAttachEnabled(e.target.checked)} />
                  Attach results as a file
                </label>
                {attachEnabled && (
                  <>
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
                    {outputs.length === 0 ? (
                      <p className="form-hint">This job has no results to attach.</p>
                    ) : (
                      <div className="result-key-list">
                        {outputs.map(({ key, kind }) => (
                          <label className="result-key-item" key={key}>
                            <input
                              type="checkbox"
                              checked={resultKeys.has(key)}
                              onChange={() => setResultKeys(toggleInSet(resultKeys, key))}
                            />
                            {KIND_ICON[kind]} {key}
                          </label>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>

            <div className="report-edit-footer">
              <button className="export-btn" onClick={() => setActiveTab('review')}>
                👁️ Review →
              </button>
            </div>
          </>
        ) : (
          <section className="report-section report-section-preview">
            <h3 className="report-section-title">👁️ Review</h3>
            <p className="form-hint">This is exactly what gets emailed — the same rendering the real send uses.</p>

            <div className="report-preview-controls">
              <button className="saved-load" disabled={previewState?.running} onClick={runRealPreview}>
                {previewState?.running ? '⏳ Running…' : usingRealData ? '🔄 Run again' : '▶ Run a real preview'}
              </button>
              <span className="report-preview-status">Status: {statusLine}</span>
            </div>
            {previewState?.error && <p className="form-hint schedule-warning">⚠️ {previewState.error}</p>}

            <div className="report-template">
              <div className="report-template-headers">
                <div>
                  <strong>From:</strong> {preview.from || '(SMTP account, set in Settings)'}
                </div>
                <div>
                  <strong>To:</strong> {preview.to || '(no recipient selected)'}
                </div>
                <div>
                  <strong>Subject:</strong> {preview.subject}
                </div>
              </div>
              <iframe className="report-preview-frame" srcDoc={preview.html} sandbox="" title="Report preview" />
              {preview.attachments && preview.attachments.length > 0 && (
                <div className="result-key-list report-template-attachments">
                  {preview.attachments.map((a) => (
                    <span key={a.filename} className="report-attachment-chip">
                      📎 {a.filename}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="report-review-actions">
              <button className="saved-load" onClick={() => setActiveTab('edit')}>
                ← Back to edit
              </button>
              <button className="export-btn" disabled={!canSubmit} onClick={handleSubmit}>
                📥 Create report
              </button>
            </div>
          </section>
        )}
      </div>

      <div className="report-footer">
        {!canSubmit && <p className="form-hint schedule-warning">Still needed: {missing.join(', ')}.</p>}
        <div className="schedule-form-actions">
          <button className="action-delete schedule-cancel-btn" onClick={() => window.close()}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
