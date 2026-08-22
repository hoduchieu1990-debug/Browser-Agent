import type { RecordedActionPayload } from '../types';
import { generateSelectorCandidates } from './selector-utils';
import { findClickableAncestor } from './clickable-element';
import { isExtensionUi } from './ui-marker';
import { findNexacroComponent, nexacroSelector, runNexacroAction, setNexacroMarking } from './nexacro';

export interface RecorderHandle {
  detach: () => void;
  setPaused: (paused: boolean) => void;
}

// Pages change between recording and replay; keeping the runner-up selectors
// lets a step survive the one it was recorded with going stale.
function selectorWithFallbacks(el: Element): { selector: string; selectorFallbacks?: string[] } {
  const [selector, ...rest] = generateSelectorCandidates(el);
  return rest.length ? { selector, selectorFallbacks: rest } : { selector };
}

export function attachListeners(onAction: (action: RecordedActionPayload, el: Element) => void): RecorderHandle {
  let fileParamCount = 0;
  // The picker registers its listeners later than these, so its
  // stopImmediatePropagation can't retroactively stop a handler that already
  // ran — pausing is the only way to keep pick-clicks out of the recording.
  let paused = false;

  const handleClick = (event: MouseEvent) => {
    if (paused) return;
    // our own overlays (Add badge, toasts) sit in the page but are not part of it
    if (isExtensionUi(event.target as Element | null)) return;

    // Nexacro renders its own object model instead of plain DOM — a component
    // id (nexacro.getActiveFrame().lookup(id)) is the only thing that reliably
    // addresses it again, so this bypasses the CSS-selector strategies below.
    const nexacroTarget = findNexacroComponent(event.target as Element | null);
    if (nexacroTarget) {
      onAction({ type: 'click', selector: nexacroSelector(nexacroTarget.id) }, nexacroTarget.element);
      return;
    }

    // clicks often land on an icon/span *inside* the real control — resolve to
    // the actual clickable ancestor so the recorded selector is stable.
    const target = findClickableAncestor(event.target as Element | null) ?? (event.target as HTMLElement);

    if (target.matches('input[type="file"]')) {
      // the browser never exposes the real file path to JS — record the
      // selector plus a ${paramN} placeholder the user fills in at run time
      // (browser-agent run ... --param file1=./data.xlsx) instead of skipping.
      const paramName = `file${++fileParamCount}`;
      onAction({ type: 'uploadFile', ...selectorWithFallbacks(target), value: `\${${paramName}}` }, target);
      return;
    }

    onAction({ type: 'click', ...selectorWithFallbacks(target) }, target);
  };

  const handleChange = (event: Event) => {
    if (paused) return;

    const target = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (target instanceof HTMLInputElement && target.type === 'file') return; // handled on click, above

    // A checkbox/radio's .value is almost always a static attribute ("on",
    // an option id, ...), never the checked state — recording it here would
    // add a bogus `input` step that replays as a no-op. The click that
    // toggled it already recorded a real `click` step through handleClick.
    if (target instanceof HTMLInputElement && (target.type === 'checkbox' || target.type === 'radio')) return;

    const nexacroTarget = findNexacroComponent(target);
    if (nexacroTarget) {
      // The component's real DOM element is rarely an <input> — reading its
      // value has to go through the component itself (get_value), not .value.
      runNexacroAction(nexacroTarget.id, 'get_value').then((result) => {
        onAction({ type: 'input', selector: nexacroSelector(nexacroTarget.id), value: result.value ?? '' }, nexacroTarget.element);
      });
      return;
    }

    const located = selectorWithFallbacks(target);

    if (target instanceof HTMLSelectElement) {
      onAction({ type: 'select', ...located, value: target.value }, target);
      return;
    }

    if (target instanceof HTMLInputElement && target.type === 'password') {
      onAction({ type: 'input', ...located, value: '${password}' }, target); // never capture the real password
      return;
    }

    onAction({ type: 'input', ...located, value: target.value }, target);
  };

  document.addEventListener('click', handleClick, true);
  document.addEventListener('change', handleChange, true);
  setNexacroMarking(true); // no-op on non-Nexacro pages, cheap either way

  return {
    detach: () => {
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('change', handleChange, true);
      setNexacroMarking(false);
    },
    setPaused: (value: boolean) => {
      paused = value;
    },
  };
}
