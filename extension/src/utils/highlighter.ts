import { findClickableAncestor } from './clickable-element';
import { markAsExtensionUi, isExtensionUi } from './ui-marker';

const OVERLAY_ID = '__browser_agent_highlight__';
const DEFAULT_COLOR = '#18181b';

// Draws an independent overlay box instead of mutating the target's own
// inline style — SPA frameworks (React/Vue/Angular) reconcile the DOM on
// every re-render and silently wipe out any style we set directly on their
// managed elements, making a target-owned outline flicker or vanish.
function createOverlay(color: string): HTMLDivElement {
  document.getElementById(OVERLAY_ID)?.remove();

  const el = document.createElement('div');
  el.id = OVERLAY_ID;
  markAsExtensionUi(el);
  el.style.position = 'fixed';
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
  let current: HTMLElement | null = null;
  let paused = false;

  const position = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.top = `${rect.top}px`;
    overlay.style.left = `${rect.left}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
  };

  const hide = () => {
    overlay.style.display = 'none';
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
    },
    setPaused: (value: boolean) => {
      paused = value;
      if (paused) hide();
    },
  };
}
