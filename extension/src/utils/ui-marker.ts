// Every DOM node this extension injects into the page carries this attribute so
// the recorder can tell "the user clicked our own UI" apart from "the user
// clicked the page", and never records a click on our own controls.
export const UI_MARKER_ATTR = 'data-browser-agent-ui';

export function markAsExtensionUi(el: HTMLElement): void {
  el.setAttribute(UI_MARKER_ATTR, '');
}

export function isExtensionUi(el: Element | null): boolean {
  return el?.closest(`[${UI_MARKER_ATTR}]`) != null;
}
