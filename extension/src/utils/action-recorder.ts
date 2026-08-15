import type { RecordedActionPayload } from '../types';
import { generateSelector } from './selector-utils';
import { findClickableAncestor } from './clickable-element';
import { isExtensionUi } from './ui-marker';

export interface RecorderHandle {
  detach: () => void;
  setPaused: (paused: boolean) => void;
}

export function attachListeners(onAction: (action: RecordedActionPayload) => void): RecorderHandle {
  let fileParamCount = 0;
  // The picker registers its listeners later than these, so its
  // stopImmediatePropagation can't retroactively stop a handler that already
  // ran — pausing is the only way to keep pick-clicks out of the recording.
  let paused = false;

  const handleClick = (event: MouseEvent) => {
    if (paused) return;
    // our own overlays (Add badge, toasts) sit in the page but are not part of it
    if (isExtensionUi(event.target as Element | null)) return;

    // clicks often land on an icon/span *inside* the real control — resolve to
    // the actual clickable ancestor so the recorded selector is stable.
    const target = findClickableAncestor(event.target as Element | null) ?? (event.target as HTMLElement);

    if (target.matches('input[type="file"]')) {
      // the browser never exposes the real file path to JS — record the
      // selector plus a ${paramN} placeholder the user fills in at run time
      // (browser-agent run ... --param file1=./data.xlsx) instead of skipping.
      const paramName = `file${++fileParamCount}`;
      onAction({ type: 'uploadFile', selector: generateSelector(target), value: `\${${paramName}}` });
      return;
    }

    onAction({ type: 'click', selector: generateSelector(target) });
  };

  const handleChange = (event: Event) => {
    if (paused) return;

    const target = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (target instanceof HTMLInputElement && target.type === 'file') return; // handled on click, above

    const selector = generateSelector(target);

    if (target instanceof HTMLSelectElement) {
      onAction({ type: 'select', selector, value: target.value });
      return;
    }

    if (target instanceof HTMLInputElement && target.type === 'password') {
      onAction({ type: 'input', selector, value: '${password}' }); // never capture the real password
      return;
    }

    onAction({ type: 'input', selector, value: target.value });
  };

  document.addEventListener('click', handleClick, true);
  document.addEventListener('change', handleChange, true);

  return {
    detach: () => {
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('change', handleChange, true);
    },
    setPaused: (value: boolean) => {
      paused = value;
    },
  };
}
