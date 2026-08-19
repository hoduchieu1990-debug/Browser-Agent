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

// A `selector` carrying this prefix names a Nexacro component id
// (nexacro.getActiveFrame().lookup(id)) instead of a CSS/XPath target —
// Nexacro renders its own object model rather than plain DOM, so the usual
// selector strategies never apply to it.
export const NEXACRO_SELECTOR_PREFIX = 'nexacro:';
