/**
 * Workflow Type Definitions for Browser Agent
 */

// ============= WORKFLOW STRUCTURE =============

export interface Workflow {
  version: string;
  name: string;
  description?: string;
  metadata?: WorkflowMetadata;
  params?: WorkflowParam[];
  globalSettings?: GlobalSettings;
  actions: WorkflowAction[];
  exportFormats?: ExportFormat[];
  /** Label only — the real rows are attached at run time (extension file picker, CLI --data). */
  dataSource?: { type: 'excel'; fileName: string };
}

export interface WorkflowMetadata {
  creator?: string;
  createdAt?: string;
  updatedAt?: string;
  tags?: string[];
  minBrowserAgentVersion?: string;
  maxBrowserAgentVersion?: string;
}

export interface WorkflowParam {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'file';
  required?: boolean;
  description?: string;
  default?: any;
  fileType?: string;
  options?: string[];
}

export interface GlobalSettings {
  autoDismissPopup?: AutoDismissPopupConfig;
  handleBrowserAlerts?: BrowserAlertConfig;
  defaultTimeout?: number;
  defaultWaitTime?: number;
}

export interface AutoDismissPopupConfig {
  enabled?: boolean;
  mode?: 'smart' | 'manual';
  selectors?: string[];
  timeout?: number;
  retryCount?: number;
}

export interface BrowserAlertConfig {
  alert?: 'accept' | 'dismiss';
  confirm?: 'accept' | 'dismiss';
  prompt?: 'accept' | 'dismiss';
}

// ============= ACTIONS =============

export type WorkflowAction =
  | NavigateAction
  | ClickAction
  | InputAction
  | SelectAction
  | UploadFileAction
  | WaitAction
  | WaitForSelectorAction
  | ExtractTableAction
  | ExtractJsonAction
  | ExtractTextAction
  | DismissPopupAction
  | HoverAction
  | ScreenshotAction
  | ScrollAction
  | BatchInputAction
  | BatchClickAction
  | BatchSearchAction
  | BatchExtractAction
  | MailSendAction
  | MailReadAction
  | MailSearchAction
  | MailAttachmentAction
  | FileReadExcelAction
  | FileWriteExcelAction
  | FileReadPdfAction
  | FileMoveAction
  | DbQueryAction
  | DbExecuteAction
  | DbExportAction
  | ApiGetAction
  | ApiPostAction
  | ApiJsonParseAction;

export type ActionType =
  | 'navigate'
  | 'click'
  | 'input'
  | 'select'
  | 'uploadFile'
  | 'wait'
  | 'waitForSelector'
  | 'extractTable'
  | 'extractJson'
  | 'extractText'
  | 'dismissPopup'
  | 'hover'
  | 'screenshot'
  | 'scroll'
  | 'batchInput'
  | 'batchClick'
  | 'batchSearch'
  | 'batchExtract'
  | 'mailSend'
  | 'mailRead'
  | 'mailSearch'
  | 'mailAttachment'
  | 'fileReadExcel'
  | 'fileWriteExcel'
  | 'fileReadPdf'
  | 'fileMove'
  | 'dbQuery'
  | 'dbExecute'
  | 'dbExport'
  | 'apiGet'
  | 'apiPost'
  | 'apiJsonParse';

/** Enterprise UI frameworks that render their own widgets instead of plain HTML controls. */
export type ActionFramework = 'nexacro' | 'websquare';

export interface BaseAction {
  id: string;
  type: ActionType;
  waitBefore?: number;
  waitAfter?: number;
  retry?: RetryConfig;
  onError?: 'fail' | 'skip' | 'ignore';
  /** Alternative selectors, tried in order when `selector` no longer matches. */
  selectorFallbacks?: string[];
  /** A label the user gave this step — display only, never read during replay. */
  note?: string;
  /**
   * Which framework rendered the element, when it wasn't plain HTML. Recorded
   * as a hint for whoever reads the workflow later; never read during replay,
   * which decides how to drive a step from the selector alone.
   */
  framework?: ActionFramework;
}

export interface RetryConfig {
  count: number;
  delayMs: number;
}

// --- Navigation ---
export interface NavigateAction extends BaseAction {
  type: 'navigate';
  url: string;
}

// --- Click ---
export interface ClickAction extends BaseAction {
  type: 'click';
  selector: string;
}

// --- Input ---
export interface InputAction extends BaseAction {
  type: 'input';
  selector: string;
  value: string;
}

// --- Select ---
export interface SelectAction extends BaseAction {
  type: 'select';
  selector: string;
  value: string;
}

// --- Upload File ---
export interface UploadFileAction extends BaseAction {
  type: 'uploadFile';
  selector: string;
  value: string; // File path, can use ${param}
}

// --- Wait ---
export interface WaitAction extends BaseAction {
  type: 'wait';
  duration: number;
}

// --- Wait for Selector ---
export interface WaitForSelectorAction extends BaseAction {
  type: 'waitForSelector';
  selector: string;
  timeout?: number;
}

// --- Extract Table ---
export interface ExtractTableAction extends BaseAction {
  type: 'extractTable';
  selector: string;
  headers?: string[];
  output: string;
}

// --- Extract JSON ---
export interface ExtractJsonAction extends BaseAction {
  type: 'extractJson';
  selector?: string;
  output: string;
  path?: string; // JSONPath if needed
}

// --- Extract Text ---
export interface ExtractTextAction extends BaseAction {
  type: 'extractText';
  selector: string;
  output: string;
}

// --- Dismiss Popup ---
export interface DismissPopupAction extends BaseAction {
  type: 'dismissPopup';
  selectors?: string[];
  timeout?: number;
}

// --- Hover ---
// Triggers a tooltip/menu/popover that only renders once something real
// hovers the element — recorded as its own step so replay can re-open it
// before a later step tries to act on whatever it reveals.
export interface HoverAction extends BaseAction {
  type: 'hover';
  selector: string;
}

// --- Screenshot ---
export interface ScreenshotAction extends BaseAction {
  type: 'screenshot';
  filename?: string;
  selector?: string; // capture just this element instead of the whole page
  output?: string;
}

// --- Scroll ---
export interface ScrollAction extends BaseAction {
  type: 'scroll';
  position?: 'top' | 'bottom' | 'center';
  pixels?: number;
}

// --- Batch: Input (one recorded field, replayed once per dataset row) ---
export type BatchInputType = 'text' | 'fileUpload' | 'select'; // Phase 2: checkbox, radio, date
export type BatchReplaceMode = 'replace' | 'append' | 'keepExisting';

export interface BatchInputAction extends BaseAction {
  type: 'batchInput';
  selector: string;
  inputType: BatchInputType;
  /** Dataset column header this node reads its value from. */
  column: string;
  /** Default 'replace'. */
  replaceMode?: BatchReplaceMode;
}

// --- Batch: Click ---
export interface BatchClickAction extends BaseAction {
  type: 'batchClick';
  selector: string;
}

// --- Batch: Search (trigger + wait for the result to be ready) ---
export type BatchWaitConditionType = 'elementAppears'; // Phase 2/3: disappears, text*, networkIdle, custom

export interface BatchWaitCondition {
  type: BatchWaitConditionType;
  /** Element to watch; defaults to the Search node's own selector. */
  selector?: string;
  timeout: number;
}

export interface BatchSearchAction extends BaseAction {
  type: 'batchSearch';
  selector: string;
  waitCondition: BatchWaitCondition;
}

// --- Batch: Extract ---
export type BatchExtractType = 'text' | 'attribute' | 'value';

export interface BatchExtractAction extends BaseAction {
  type: 'batchExtract';
  selector: string;
  extractType: BatchExtractType;
  /** Required when extractType === 'attribute'. */
  attribute?: string;
  output: string;
}

// ============= MAIL =============
// Node-only: these need a real SMTP/IMAP socket, so they run through the
// player/cli engine — the extension's in-browser replay reports them as
// unsupported (see replay-executor.ts's default case) rather than attempting
// them from inside the sandboxed browser context.

export interface MailConnection {
  host: string;
  port: number;
  secure?: boolean;
  // Optional: some internal relays (SMTP_Secure=false, port 25) accept mail
  // from trusted hosts with no auth at all.
  user?: string;
  password?: string;
}

export interface MailAttachmentInput {
  filePath: string;
  filename?: string;
}

export interface MailSendAction extends BaseAction, MailConnection {
  type: 'mailSend';
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  /** Whether `body` is HTML; defaults to false (plain text). */
  html?: boolean;
  attachments?: MailAttachmentInput[];
}

export interface MailReadAction extends BaseAction, MailConnection {
  type: 'mailRead';
  /** Defaults to 'INBOX'. */
  mailbox?: string;
  /** Defaults to 'unseen'. */
  criteria?: 'all' | 'unseen';
  /** Defaults to 10. */
  limit?: number;
  /** Mark matched messages as read; defaults to false. */
  markSeen?: boolean;
  output: string;
}

export interface MailSearchAction extends BaseAction, MailConnection {
  type: 'mailSearch';
  mailbox?: string;
  from?: string;
  subject?: string;
  /** ISO date; only messages received on/after this date match. */
  since?: string;
  unseen?: boolean;
  limit?: number;
  output: string;
}

export interface MailAttachmentAction extends BaseAction, MailConnection {
  type: 'mailAttachment';
  /** The mailRead/mailSearch result only carries a UID — downloading its
   *  attachments means reopening the same mailbox, so this needs its own
   *  connection details rather than reusing whatever the earlier step had. */
  mailbox?: string;
  /** Name of the variable holding a mailRead/mailSearch result to pull attachments from. */
  source: string;
  saveDir: string;
  output: string;
}

// ============= FILE =============
// Node-only: raw filesystem access, unavailable to the extension's sandboxed
// content-script/service-worker context.

export interface FileReadExcelAction extends BaseAction {
  type: 'fileReadExcel';
  filePath: string;
  /** Sheet name or 1-based index; defaults to the first sheet. */
  sheet?: string | number;
  /** Treat the first row as column names; defaults to true. */
  headerRow?: boolean;
  output: string;
}

export interface FileWriteExcelAction extends BaseAction {
  type: 'fileWriteExcel';
  filePath: string;
  /** Defaults to 'Sheet1'. */
  sheet?: string;
  /** Name of the variable holding the rows (array of objects) to write. */
  data: string;
  /** Write each row object's keys as a header row; defaults to true. */
  headerRow?: boolean;
}

export interface FileReadPdfAction extends BaseAction {
  type: 'fileReadPdf';
  filePath: string;
  output: string;
}

export interface FileMoveAction extends BaseAction {
  type: 'fileMove';
  sourcePath: string;
  destPath: string;
  overwrite?: boolean;
}

// ============= DATABASE =============
// Node-only: no native DB driver/raw TCP socket is available in the extension.

export interface DbConnectionConfig {
  server: string;
  database: string;
  user: string;
  password: string;
  port?: number;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
}

export type DbParamValue = string | number | boolean | null;

export interface DbQueryAction extends BaseAction {
  type: 'dbQuery';
  connection: DbConnectionConfig;
  query: string;
  params?: DbParamValue[];
  output: string;
}

export interface DbExecuteAction extends BaseAction {
  type: 'dbExecute';
  connection: DbConnectionConfig;
  statement: string;
  params?: DbParamValue[];
  /** Variable to hold the affected row count; optional since it's often unused. */
  output?: string;
}

export interface DbExportAction extends BaseAction {
  type: 'dbExport';
  connection: DbConnectionConfig;
  query: string;
  params?: DbParamValue[];
  format: 'csv' | 'excel' | 'json';
  filePath: string;
  /** Variable to hold the saved file's path. */
  output?: string;
}

// ============= API =============
// Runs equally well in the extension (fetch) or the player (Node fetch) —
// unlike Mail/File/Database, nothing here needs an OS-level resource.

export interface ApiGetAction extends BaseAction {
  type: 'apiGet';
  url: string;
  /** Named `httpHeaders`, not `headers` — that name is already extractTable's column-headers list. */
  httpHeaders?: Record<string, string>;
  queryParams?: Record<string, string>;
  output: string;
}

export interface ApiPostAction extends BaseAction {
  type: 'apiPost';
  url: string;
  httpHeaders?: Record<string, string>;
  /** Raw request body; JSON.stringify it yourself if `json` is true. */
  body?: string;
  /** Sets Content-Type: application/json; defaults to true. */
  json?: boolean;
  output: string;
}

export interface ApiJsonParseAction extends BaseAction {
  type: 'apiJsonParse';
  /** Name of the variable holding the raw JSON string to parse. */
  input: string;
  /** Dotted path into the parsed value, e.g. "data.items". */
  path?: string;
  output: string;
}

// ============= EXPORT =============

export interface ExportFormat {
  type: 'excel' | 'csv' | 'json';
  output: string;
  dataKey: string;
}

// ============= EXECUTION RESULT =============

export interface WorkflowResult {
  success: boolean;
  data: Record<string, any>;
  files: Record<string, string>;
  logs: string[];
  duration: number;
  timestamp: string;
  error?: ExecutionError;
}

export interface ExecutionError {
  actionId: string;
  type: string;
  message: string;
  step: number;
  timestamp: string;
}

// ============= EXECUTION CONTEXT =============

export interface ExecutionContext {
  workflow: Workflow;
  params: Record<string, any>;
  variables: Record<string, any>;
  currentStep: number;
  logs: string[];
  startTime: number;
}

// ============= VALIDATORS =============

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  field: string;
  message: string;
  severity: 'error';
}

export interface ValidationWarning {
  field: string;
  message: string;
  severity: 'warning';
}

// ============= HELPERS =============

/**
 * Type guard: Check if action is NavigateAction
 */
export function isNavigateAction(action: WorkflowAction): action is NavigateAction {
  return action.type === 'navigate';
}

/**
 * Type guard: Check if action is UploadFileAction
 */
export function isUploadFileAction(action: WorkflowAction): action is UploadFileAction {
  return action.type === 'uploadFile';
}

/**
 * Type guard: Check if action is ExtractTableAction
 */
export function isExtractTableAction(action: WorkflowAction): action is ExtractTableAction {
  return action.type === 'extractTable';
}

/**
 * Type guard: Check if action is ExtractTextAction
 */
export function isExtractTextAction(action: WorkflowAction): action is ExtractTextAction {
  return action.type === 'extractText';
}
