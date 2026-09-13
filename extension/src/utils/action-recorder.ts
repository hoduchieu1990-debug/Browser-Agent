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

  // A search box that answers Enter (or a click on its own "Search" button)
  // with its own JS never blurs — plenty of them call preventDefault() on
  // mousedown specifically to keep the field focused, e.g. so a suggestions
  // dropdown does not close before the click registers. `change`, which only
  // fires on blur, then never fires either, and the typed value silently
  // never made it into the recording. Tracking the last value actually
  // recorded per field lets the blur path, the Enter path, and the
  // still-focused-at-click path below share one recorder without
  // double-recording when a field happens to trigger more than one of them
  // for the same value.
  let lastRecordedEl: Element | null = null;
  let lastRecordedValue: string | null = null;

  // A Nexacro Grid cell combo's inline editor (id ...cellcomboN.comboedit:input)
  // fires its own input/change the instant the cell is clicked open — before
  // the user has picked anything — echoing whatever text was already
  // displayed there, not something they typed. Confirmed live: recording it
  // as a real `input` step, then replaying it by setting .value directly
  // (not a real click), made Nexacro close the dropdown before the actual
  // choice — the click on the popup's option right after it — ever got a
  // chance to run, so replay failed with "element not found" on a popup that
  // real user interaction would have kept open. The click that opens the
  // cell and the click that picks the option are what actually matter; this
  // one in between is a side effect of the first, not its own user action.
  const isNexacroComboEditEcho = (el: Element): boolean => /\.comboedit:input$/.test(el.id);

  const recordFieldValue = (target: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): void => {
    if (target instanceof HTMLInputElement && target.type === 'file') return; // handled on click, above
    if (isNexacroComboEditEcho(target)) return;

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
        const value = result.value ?? '';
        if (lastRecordedEl === nexacroTarget.element && lastRecordedValue === value) return;
        lastRecordedEl = nexacroTarget.element;
        lastRecordedValue = value;
        onAction({ type: 'input', selector: nexacroSelector(nexacroTarget.id), value }, nexacroTarget.element);
      });
      return;
    }

    if (lastRecordedEl === target && lastRecordedValue === target.value) return;
    lastRecordedEl = target;
    lastRecordedValue = target.value;

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

  const handleChange = (event: Event) => {
    if (paused) return;
    recordFieldValue(event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement);
  };

  const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'tel', 'url', 'number']);

  const handleKeydown = (event: KeyboardEvent) => {
    if (paused || event.key !== 'Enter') return;
    const target = event.target;
    const isTextInput = target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type);
    if (!isTextInput && !(target instanceof HTMLTextAreaElement) && !findNexacroComponent(target as Element | null)) return;
    recordFieldValue(target as HTMLInputElement | HTMLTextAreaElement);
  };

  const handleClick = (event: MouseEvent) => {
    if (paused) return;
    // our own overlays (Add badge, toasts) sit in the page but are not part of it
    if (isExtensionUi(event.target as Element | null)) return;

    // Whatever field still has focus right as a click lands elsewhere gets
    // finalized first — this is what catches the "Search" button that kept
    // the field focused on mousedown (see the comment on recordFieldValue
    // above): neither blur nor Enter ever fired on it, but a click landing
    // somewhere else is still a clear sign the typed value is done. The
    // dedup in recordFieldValue means this is a no-op on every ordinary
    // click where the active element's value was already recorded.
    const active = document.activeElement;
    if (
      active &&
      active !== event.target &&
      !isExtensionUi(active) &&
      (active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement ||
        findNexacroComponent(active))
    ) {
      recordFieldValue(active as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement);
    }

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

  document.addEventListener('click', handleClick, true);
  document.addEventListener('change', handleChange, true);
  document.addEventListener('keydown', handleKeydown, true);
  setNexacroMarking(true); // no-op on non-Nexacro pages, cheap either way

  return {
    detach: () => {
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('change', handleChange, true);
      document.removeEventListener('keydown', handleKeydown, true);
      setNexacroMarking(false);
    },
    setPaused: (value: boolean) => {
      paused = value;
    },
  };
}
