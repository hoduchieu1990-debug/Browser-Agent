export const DEFAULT_TIMEOUT = 10000;
export const DEFAULT_WAIT_TIME = 1000;
export const DEFAULT_POPUP_TIMEOUT = 2000;
export const DEFAULT_POPUP_RETRY_COUNT = 2;

export const ACTION_TYPES = [
  'navigate',
  'click',
  'input',
  'select',
  'uploadFile',
  'wait',
  'waitForSelector',
  'extractTable',
  'extractJson',
  'extractText',
  'dismissPopup',
  'screenshot',
  'scroll',
] as const;

export const EXPORT_TYPES = ['excel', 'csv', 'json'] as const;
