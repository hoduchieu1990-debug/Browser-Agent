import type { ActionHandler, RunContext } from '../types';
import { navigate } from './navigate';
import { click } from './click';
import { input } from './input';
import { select } from './select';
import { uploadFile } from './upload-file';
import { wait, waitForSelector } from './wait';
import { extractTable } from './extract-table';
import { extractJson } from './extract-json';
import { extractText } from './extract-text';
import { dismissPopup } from './dismiss-popup';
import { screenshot } from './screenshot';
import { scroll } from './scroll';
import { batchInput } from './batch-input';
import { batchClick } from './batch-click';
import { batchSearch } from './batch-search';
import { batchExtract } from './batch-extract';

const registry = new Map<string, ActionHandler>([
  ['navigate', navigate],
  ['click', click],
  ['input', input],
  ['select', select],
  ['uploadFile', uploadFile],
  ['wait', wait],
  ['waitForSelector', waitForSelector],
  ['extractTable', extractTable],
  ['extractJson', extractJson],
  ['extractText', extractText],
  ['dismissPopup', dismissPopup],
  ['screenshot', (page, action, ctx: RunContext) => screenshot(page, action, ctx.outputDir)],
  ['scroll', scroll],
  ['batchInput', batchInput],
  ['batchClick', batchClick],
  ['batchSearch', batchSearch],
  ['batchExtract', batchExtract],
]);

export function registerActionHandler(type: string, handler: ActionHandler): void {
  registry.set(type, handler);
}

export function getActionHandler(type: string): ActionHandler {
  const handler = registry.get(type);
  if (!handler) throw new Error(`Unknown action type: ${type}`);
  return handler;
}
