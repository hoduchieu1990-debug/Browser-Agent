import { findClickableAncestor } from './clickable-element';
import { markAsExtensionUi, isExtensionUi } from './ui-marker';

const OVERLAY_ID = '__browser_agent_highlight__';
// The same indigo the capture frame uses (extract-badge.ts's createTargetFrame)
// — one hover colour for the whole recording experience, rather than a
// near-black outline that reads as "something is broken/selected" rather than
// "this is what the extension is pointing at".
const DEFAULT_COLOR = '#4f46e5';

// Draws an independent overlay box instead of mutating the target's own
// inline style — SPA frameworks (React/Vue/Angular) reconcile the DOM on
// every re-render and silently wipe out any style we set directly on their
// managed elements, making a target-owned outline flicker or vanish.
function createOverlay(color: string): HTMLDivElement {
  document.getElementById(OVERLAY_ID)?.remove();

  const el = document.createElement('div');
  el.id = OVERLAY_ID;
  markAsExtensionUi(el);
  // !important: a real Nexacro app forces every div to position:absolute
  // globally (its own widgets are all absolutely-positioned divs) — without
  // this, that rule wins over the plain inline style and the outline stops
  // tracking the viewport like position:fixed is supposed to.
  el.style.setProperty('position', 'fixed', 'important');
  el.style.pointerEvents = 'none';
  el.style.boxSizing = 'border-box';
  el.style.border = `2px solid ${color}`;
  el.style.background = hexToRgba(color, 0.12);
  el.style.borderRadius = '2px';
  el.style.zIndex = '2147483647';
  el.style.display = 'none';
  el.style.transition = 'none';
  document.documentElement.appendChild(el);
  return el;
}

const LABEL_ID = '__browser_agent_highlight_label__';

// A one-line teaching hint riding along with the outline — reuses the exact
// rect the outline already computed on this same mouseover, so it costs one
// more small element positioned alongside it, not another pass over the DOM.
function createLabel(color: string): HTMLDivElement {
  document.getElementById(LABEL_ID)?.remove();

  const el = document.createElement('div');
  el.id = LABEL_ID;
  markAsExtensionUi(el);
  el.textContent = 'Ctrl+Right-click to add data';
  el.style.setProperty('position', 'fixed', 'important'); // see createOverlay's own comment above
  el.style.pointerEvents = 'none';
  el.style.padding = '2px 7px';
  el.style.borderRadius = '4px';
  el.style.background = color;
  el.style.color = '#fff';
  el.style.font = '600 11px system-ui, "Segoe UI", sans-serif';
  el.style.whiteSpace = 'nowrap';
  el.style.zIndex = '2147483647';
  el.style.display = 'none';
  el.style.transition = 'none';
  document.documentElement.appendChild(el);
  return el;
}

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type Resolver = (el: Element | null) => HTMLElement | null;

export interface HighlighterHandle {
  detach: () => void;
  /** Stand down while the Add badge is drawing its own, more specific frame. */
  setPaused: (paused: boolean) => void;
}

export function attachHighlighter(
  resolveTarget: Resolver = findClickableAncestor,
  color: string = DEFAULT_COLOR,
): HighlighterHandle {
  const overlay = createOverlay(color);
  const label = createLabel(color);
  let current: HTMLElement | null = null;
  let paused = false;

  const position = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.top = `${rect.top}px`;
    overlay.style.left = `${rect.left}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;

    label.style.display = 'block';
    label.style.left = `${Math.max(4, rect.left)}px`;
    // Sits just above the box, unless that would push it off the top of the
    // screen — then it drops just below instead, the same rule the extract
    // badge's own "Selected" tag uses for the same reason.
    label.style.top = rect.top < 22 ? `${rect.bottom + 4}px` : `${rect.top - 20}px`;
  };

  const hide = () => {
    overlay.style.display = 'none';
    label.style.display = 'none';
    current = null;
  };

  const handleOver = (event: MouseEvent) => {
    if (paused) {
      hide();
      return;
    }
    if (isExtensionUi(event.target as Element | null)) {
      hide(); // our own panel and controls are not page content
      return;
    }
    const target = resolveTarget(event.target as Element | null);
    current = target;
    if (target) position(target);
    else hide();
  };

  const handleScroll = () => {
    if (current) position(current);
  };

  document.addEventListener('mouseover', handleOver, true);
  document.addEventListener('mouseleave', hide, true);
  window.addEventListener('scroll', handleScroll, true);

  return {
    detach: () => {
      document.removeEventListener('mouseover', handleOver, true);
      document.removeEventListener('mouseleave', hide, true);
      window.removeEventListener('scroll', handleScroll, true);
      overlay.remove();
      label.remove();
    },
    setPaused: (value: boolean) => {
      paused = value;
      if (paused) hide();
    },
  };
}
