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
  | ScreenshotAction
  | ScrollAction;

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
  | 'screenshot'
  | 'scroll';

export interface BaseAction {
  id: string;
  type: ActionType;
  waitBefore?: number;
  waitAfter?: number;
  retry?: RetryConfig;
  onError?: 'fail' | 'skip' | 'ignore';
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
