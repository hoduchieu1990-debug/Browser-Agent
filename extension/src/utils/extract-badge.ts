import { findTableAncestor } from './clickable-element';
import { markAsExtensionUi, isExtensionUi } from './ui-marker';

const BADGE_ID = '__browser_agent_add_badge__';
const MAX_TEXT_LENGTH = 300;
const HIDE_DELAY_MS = 1400;
const IDLE_ON_BADGE_MS = 2500;

export interface BadgeCallbacks {
  onAddTable: (table: HTMLTableElement) => void;
  onAddText: (el: HTMLElement) => void;
  onAddImage: (el: HTMLElement) => void;
}

// An element is worth offering "Add text" for when it holds a short, concrete
// value (a price, a status, a cell) rather than a whole page section.
function findTextTarget(el: Element | null): HTMLElement | null {
  if (!(el instanceof HTMLElement)) return null;
  if (el === document.body || el === document.documentElement) return null;
  if (isExtensionUi(el)) return null; // never offer to capture our own panel

  const text = el.textContent?.trim() ?? '';
  if (!text || text.length > MAX_TEXT_LENGTH) return null;
  if (el.querySelector('table')) return null;

  return el;
}

function styleMenuItem(btn: HTMLButtonElement): void {
  btn.type = 'button';
  btn.style.display = 'flex';
  btn.style.alignItems = 'center';
  btn.style.gap = '8px';
  btn.style.width = '100%';
  btn.style.padding = '7px 12px';
  btn.style.border = 'none';
  btn.style.background = 'transparent';
  btn.style.color = '#f1eefc';
  btn.style.font = '500 12px "Segoe UI", Tahoma, sans-serif';
  btn.style.textAlign = 'left';
  btn.style.cursor = 'pointer';
  btn.style.whiteSpace = 'nowrap';

  btn.addEventListener('mouseenter', () => (btn.style.background = 'rgba(139, 92, 246, 0.25)'));
  btn.addEventListener('mouseleave', () => (btn.style.background = 'transparent'));
}

interface BadgeElements {
  root: HTMLDivElement;
  trigger: HTMLButtonElement;
  menu: HTMLDivElement;
  tableItem: HTMLButtonElement;
  textItem: HTMLButtonElement;
  imageItem: HTMLButtonElement;
}

function createBadge(): BadgeElements {
  document.getElementById(BADGE_ID)?.remove();

  const root = document.createElement('div');
  root.id = BADGE_ID;
  markAsExtensionUi(root);
  root.style.position = 'fixed';
  root.style.zIndex = '2147483647';
  root.style.display = 'none';
  root.style.flexDirection = 'column';
  root.style.alignItems = 'flex-start';
  root.style.gap = '4px';
  root.style.pointerEvents = 'auto';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.textContent = '＋ Add';
  trigger.style.border = 'none';
  trigger.style.borderRadius = '999px';
  trigger.style.padding = '5px 14px';
  trigger.style.background = 'linear-gradient(135deg, #8b5cf6 0%, #22d3ee 100%)';
  trigger.style.color = '#fff';
  trigger.style.font = '600 11px "Segoe UI", Tahoma, sans-serif';
  trigger.style.cursor = 'pointer';
  trigger.style.boxShadow = '0 2px 10px rgba(139, 92, 246, 0.6)';

  const menu = document.createElement('div');
  menu.style.display = 'none';
  menu.style.flexDirection = 'column';
  menu.style.minWidth = '168px';
  menu.style.padding = '4px 0';
  menu.style.borderRadius = '8px';
  menu.style.background = '#1c1830';
  menu.style.border = '1px solid #322b52';
  menu.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.5)';

  const tableItem = document.createElement('button');
  tableItem.textContent = '📊  Table data';
  const textItem = document.createElement('button');
  textItem.textContent = '🎯  Text value';
  const imageItem = document.createElement('button');
  imageItem.textContent = '🖼️  Image of this area';
  [tableItem, textItem, imageItem].forEach(styleMenuItem);

  menu.append(tableItem, textItem, imageItem);
  root.append(trigger, menu);
  document.documentElement.appendChild(root);

  return { root, trigger, menu, tableItem, textItem, imageItem };
}

// Follows the pointer during recording and offers to capture whatever is under
// it, so extracting data never requires leaving the page for the popup.
export function attachExtractBadge({ onAddTable, onAddText, onAddImage }: BadgeCallbacks): () => void {
  const { root, trigger, menu, tableItem, textItem, imageItem } = createBadge();

  let currentTable: HTMLTableElement | null = null;
  let currentText: HTMLElement | null = null;
  let hideTimer: number | null = null;
  let menuOpen = false;

  const position = (anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    root.style.display = 'flex';

    // measure the pill only: when the menu is open the root is much taller/wider
    const width = trigger.offsetWidth || 70;
    const height = trigger.offsetHeight || 24;
    const GAP = 6;

    // Prefer the empty space to the right of the target. Sitting above it looks
    // tidy but covers the line above, and the badge captures pointer events —
    // whatever it covers becomes unhoverable and unclickable.
    let left = rect.right + GAP;
    let top = rect.top;

    if (left + width > window.innerWidth - GAP) {
      left = Math.max(GAP, Math.min(rect.left, window.innerWidth - width - GAP));
      const above = rect.top - height - GAP;
      top = above >= GAP ? above : rect.bottom + GAP;
    }

    root.style.left = `${left}px`;
    root.style.top = `${Math.max(GAP, Math.min(top, window.innerHeight - height - GAP))}px`;
  };

  const closeMenu = () => {
    menuOpen = false;
    menu.style.display = 'none';
  };

  const hide = () => {
    closeMenu();
    root.style.display = 'none';
    currentTable = null;
    currentText = null;
  };

  const cancelHide = () => {
    if (hideTimer !== null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  };

  // Leaving the target must not yank the badge away instantly, or the pointer
  // can never travel the gap to reach it.
  const scheduleHide = (delayMs = HIDE_DELAY_MS) => {
    if (menuOpen) return; // an open menu waits for a choice, however long that takes
    if (hideTimer === null) hideTimer = window.setTimeout(hide, delayMs);
  };

  const handleOver = (event: MouseEvent) => {
    const target = event.target as Element | null;
    if (target && root.contains(target)) {
      // The badge sits over page content, so it cannot linger forever just
      // because the pointer is resting on it — that would permanently block
      // whatever is underneath. Long enough to click, short enough to move on.
      cancelHide();
      scheduleHide(IDLE_ON_BADGE_MS);
      return;
    }
    if (menuOpen) return; // don't re-target while the user is choosing

    const table = findTableAncestor(target);
    const text = findTextTarget(target);

    if (!table && !text) {
      scheduleHide();
      return;
    }

    // An ancestor of the current target is usually just the container the
    // pointer crosses on its way to the badge — re-anchoring there would make
    // the badge jump out from under the pointer.
    const anchored = currentTable ?? currentText;
    if (anchored && (text?.contains(anchored) || table?.contains(anchored)) && (text ?? table) !== anchored) {
      cancelHide();
      return;
    }

    cancelHide();
    currentTable = table;
    currentText = text;
    position(table ?? text!);
  };

  const handleScroll = () => {
    const anchor = currentTable ?? currentText;
    if (anchor) position(anchor);
  };

  const stop = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  const handleTriggerClick = (event: MouseEvent) => {
    stop(event);
    cancelHide();
    menuOpen = !menuOpen;
    tableItem.style.display = currentTable ? 'flex' : 'none';
    menu.style.display = menuOpen ? 'flex' : 'none';
  };

  const choose = (event: MouseEvent, run: () => void) => {
    stop(event);
    run();
    hide();
  };

  const handleTable = (event: MouseEvent) => {
    const table = currentTable;
    choose(event, () => table && onAddTable(table));
  };

  const handleText = (event: MouseEvent) => {
    const el = currentText ?? currentTable;
    choose(event, () => el && onAddText(el));
  };

  const handleImage = (event: MouseEvent) => {
    const el = currentTable ?? currentText;
    choose(event, () => el && onAddImage(el));
  };

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') hide();
  };

  const handleOutsideClick = (event: MouseEvent) => {
    if (menuOpen && !root.contains(event.target as Node)) hide();
  };

  trigger.addEventListener('click', handleTriggerClick, true);
  tableItem.addEventListener('click', handleTable, true);
  textItem.addEventListener('click', handleText, true);
  imageItem.addEventListener('click', handleImage, true);
  document.addEventListener('mouseover', handleOver, true);
  document.addEventListener('keydown', handleKeydown, true);
  document.addEventListener('click', handleOutsideClick, true);
  window.addEventListener('scroll', handleScroll, true);

  return () => {
    cancelHide();
    document.removeEventListener('mouseover', handleOver, true);
    document.removeEventListener('keydown', handleKeydown, true);
    document.removeEventListener('click', handleOutsideClick, true);
    window.removeEventListener('scroll', handleScroll, true);
    root.remove();
  };
}
