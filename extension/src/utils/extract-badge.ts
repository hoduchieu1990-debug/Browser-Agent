import { findTableAncestor, findClickableAncestor } from './clickable-element';
import { generateSelectorCandidates } from './selector-utils';
import { markAsExtensionUi, isExtensionUi } from './ui-marker';

const BADGE_ID = '__browser_agent_add_badge__';
const MAX_TEXT_LENGTH = 300;
const HIDE_DELAY_MS = 4000;
// A locked-in target only gives way to a new one after this long — enough to
// tell "I paused here on purpose" from "I'm just passing through on my way
// to the Add button".
const RETARGET_DEBOUNCE_MS = 150;
const CURSOR_OFFSET_PX = 18;
// The badge only needs to hold still over the short hop from the element to
// itself; freezing over a wider radius would also swallow moves to a
// neighbouring element, silently capturing the wrong thing.
const APPROACH_MARGIN_PX = 34;

export type BatchKind = 'input' | 'click' | 'search' | 'extract';

export interface BadgeCallbacks {
  onAddTable: (table: HTMLElement) => void;
  onAddText: (el: HTMLElement) => void;
  onAddImage: (el: HTMLElement) => void;
  onAddBatch: (el: HTMLElement, kind: BatchKind) => void;
  /** Fires when the badge takes over (or releases) showing the outline. */
  onTargetChange?: (hasTarget: boolean) => void;
}

// Syntax highlighters and rich text shred a value into anonymous <span>s. The
// pointer lands on one of those fragments, which cannot be located again on the
// next visit — the block that contains it can.
const INLINE_TAGS = new Set([
  'SPAN', 'CODE', 'B', 'I', 'EM', 'STRONG', 'SMALL', 'MARK', 'U', 'S',
  'SUB', 'SUP', 'FONT', 'ABBR', 'CITE', 'KBD', 'SAMP', 'VAR', 'TIME',
]);

// Index- and position-based selectors locate an element by where it sits, not
// by what it is — good enough to replay, but a sign the element itself is
// anonymous and its container is the better thing to capture.
function isPositionOnly(el: Element): boolean {
  const best = generateSelectorCandidates(el)[0];
  return best.startsWith('body >') || best.startsWith(':nth-match(') || best.includes(':nth-of-type(');
}

function preferLocatable(el: HTMLElement): HTMLElement {
  let current = el;

  for (let depth = 0; depth < 5; depth++) {
    if (!isPositionOnly(current)) return current;

    const parent = current.parentElement;
    if (!parent || !INLINE_TAGS.has(current.tagName)) break;
    if ((parent.textContent?.trim().length ?? 0) > MAX_TEXT_LENGTH) break;
    current = parent;
  }

  return current;
}

// An element is worth offering "Add text" for when it holds a short, concrete
// value (a price, a status, a cell) rather than a whole page section.
function findTextTarget(el: Element | null): HTMLElement | null {
  if (!(el instanceof HTMLElement)) return null;
  if (el === document.body || el === document.documentElement) return null;
  if (isExtensionUi(el)) return null; // never offer to capture our own overlays

  const text = el.textContent?.trim() ?? '';
  if (!text || text.length > MAX_TEXT_LENGTH) return null;
  if (el.querySelector('table')) return null;

  return preferLocatable(el);
}

// Batch Input/Click/Search target form controls and buttons, most of which
// have no text of their own and so never match findTextTarget above.
const BATCH_TAGS = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA']);
const BATCH_ROLES = new Set(['button', 'link', 'checkbox', 'radio']);

function findBatchTarget(el: Element | null): HTMLElement | null {
  let current = el;

  for (let depth = 0; current && depth < 6; depth++) {
    if (current instanceof HTMLElement && !isExtensionUi(current)) {
      if (BATCH_TAGS.has(current.tagName)) return current;
      const role = current.getAttribute('role');
      if (role && BATCH_ROLES.has(role)) return current;
    }
    current = current.parentElement;
  }

  return null;
}

const BATCH_LABELS: Record<BatchKind, string> = {
  input: '⌨️  Input',
  click: '🖱️  Click',
  search: '🔎  Search',
  extract: '📤  Extract',
};

function styleMenuDivider(): HTMLDivElement {
  const divider = document.createElement('div');
  divider.style.margin = '4px 0';
  divider.style.borderTop = '1px solid #e5e9f0';
  return divider;
}

function styleMenuLabel(text: string): HTMLDivElement {
  const label = document.createElement('div');
  label.textContent = text;
  label.style.padding = '4px 12px 2px';
  label.style.font = '600 10px system-ui, "Segoe UI", sans-serif';
  label.style.textTransform = 'uppercase';
  label.style.letterSpacing = '0.04em';
  label.style.color = '#94a3b8';
  return label;
}

function styleMenuItem(btn: HTMLButtonElement): void {
  btn.type = 'button';
  btn.style.display = 'flex';
  btn.style.alignItems = 'center';
  btn.style.gap = '8px';
  btn.style.width = '100%';
  btn.style.padding = '8px 12px';
  btn.style.border = 'none';
  btn.style.background = 'transparent';
  btn.style.color = '#1e293b';
  btn.style.font = '500 12px system-ui, "Segoe UI", sans-serif';
  btn.style.textAlign = 'left';
  btn.style.cursor = 'pointer';
  btn.style.whiteSpace = 'nowrap';

  btn.addEventListener('mouseenter', () => (btn.style.background = '#eef1f7'));
  btn.addEventListener('mouseleave', () => (btn.style.background = 'transparent'));
}

const FRAME_ID = '__browser_agent_target_frame__';

interface TargetFrame {
  show: (el: Element, label: string) => void;
  hide: () => void;
  remove: () => void;
}

// Answers "what exactly am I adding?" — the badge sits next to the cursor, so
// without this the element it is aimed at is guesswork.
function createTargetFrame(): TargetFrame {
  document.getElementById(FRAME_ID)?.remove();

  const box = document.createElement('div');
  box.id = FRAME_ID;
  markAsExtensionUi(box);
  box.style.position = 'fixed';
  box.style.pointerEvents = 'none';
  box.style.boxSizing = 'border-box';
  box.style.border = '2px solid #4f46e5';
  box.style.background = 'rgba(79, 70, 229, 0.10)';
  box.style.borderRadius = '3px';
  box.style.zIndex = '2147483646';
  box.style.display = 'none';

  const tag = document.createElement('span');
  tag.style.position = 'absolute';
  tag.style.left = '0';
  tag.style.top = '-19px';
  tag.style.padding = '1px 7px';
  tag.style.borderRadius = '4px';
  tag.style.background = '#4f46e5';
  tag.style.color = '#fff';
  tag.style.font = '600 10px system-ui, "Segoe UI", sans-serif';
  tag.style.whiteSpace = 'nowrap';
  box.appendChild(tag);

  document.documentElement.appendChild(box);

  return {
    show: (el, label) => {
      const rect = el.getBoundingClientRect();
      box.style.display = 'block';
      box.style.top = `${rect.top}px`;
      box.style.left = `${rect.left}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      tag.textContent = label;
      // a frame hugging the top of the viewport would push its label off-screen
      tag.style.top = rect.top < 22 ? '100%' : '-19px';
    },
    hide: () => {
      box.style.display = 'none';
    },
    remove: () => box.remove(),
  };
}

interface BadgeElements {
  root: HTMLDivElement;
  trigger: HTMLButtonElement;
  menu: HTMLDivElement;
  tableItem: HTMLButtonElement;
  textItem: HTMLButtonElement;
  imageItem: HTMLButtonElement;
  batchItems: Record<BatchKind, HTMLButtonElement>;
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
  trigger.dataset.baRole = 'add';
  trigger.textContent = '＋ Add';
  trigger.style.border = 'none';
  trigger.style.borderRadius = '999px';
  trigger.style.padding = '6px 14px';
  trigger.style.background = '#4f46e5';
  trigger.style.color = '#fff';
  trigger.style.font = '600 11px system-ui, "Segoe UI", sans-serif';
  trigger.style.cursor = 'pointer';
  trigger.style.boxShadow = '0 2px 10px rgba(79, 70, 229, 0.45)';

  const menu = document.createElement('div');
  menu.dataset.baRole = 'menu';
  menu.style.display = 'none';
  menu.style.flexDirection = 'column';
  menu.style.minWidth = '178px';
  menu.style.padding = '4px 0';
  menu.style.borderRadius = '10px';
  menu.style.background = '#fbfcfe';
  menu.style.border = '1px solid #d5dde8';
  menu.style.boxShadow = '0 8px 28px rgba(15, 23, 42, 0.18)';

  const tableItem = document.createElement('button');
  tableItem.textContent = '📊  Table data';
  const textItem = document.createElement('button');
  textItem.textContent = '🎯  Text value';
  const imageItem = document.createElement('button');
  imageItem.textContent = '🖼️  Image of this area';
  [tableItem, textItem, imageItem].forEach(styleMenuItem);

  const batchKinds: BatchKind[] = ['input', 'click', 'search', 'extract'];
  const batchItems = Object.fromEntries(
    batchKinds.map((kind) => {
      const btn = document.createElement('button');
      btn.textContent = BATCH_LABELS[kind];
      styleMenuItem(btn);
      return [kind, btn];
    }),
  ) as Record<BatchKind, HTMLButtonElement>;

  menu.append(
    tableItem,
    textItem,
    imageItem,
    styleMenuDivider(),
    styleMenuLabel('Batch'),
    ...batchKinds.map((kind) => batchItems[kind]),
  );
  root.append(trigger, menu);
  document.documentElement.appendChild(root);

  return { root, trigger, menu, tableItem, textItem, imageItem, batchItems };
}

// Rides along with the pointer during recording and offers to capture whatever
// is under it, so extracting data never requires leaving the page.
export function attachExtractBadge({
  onAddTable,
  onAddText,
  onAddImage,
  onAddBatch,
  onTargetChange,
}: BadgeCallbacks): () => void {
  const { root, trigger, menu, tableItem, textItem, imageItem, batchItems } = createBadge();
  const frame = createTargetFrame();

  let currentTable: HTMLElement | null = null;
  let currentText: HTMLElement | null = null;
  let currentBatch: HTMLElement | null = null;
  let hideTimer: number | null = null;
  let retargetTimer: number | null = null;
  let menuOpen = false;
  let anchorX = 0;
  let anchorY = 0;

  const moveTo = (x: number, y: number) => {
    const width = trigger.offsetWidth || 74;
    const height = trigger.offsetHeight || 26;
    anchorX = Math.max(4, Math.min(x, window.innerWidth - width - 4));
    anchorY = Math.max(4, Math.min(y, window.innerHeight - height - 4));
    root.style.left = `${anchorX}px`;
    root.style.top = `${anchorY}px`;
  };

  // distance to the badge's box, zero when the pointer is inside it
  const distanceToBadge = (x: number, y: number) => {
    const rect = trigger.getBoundingClientRect();
    const dx = Math.max(rect.left - x, 0, x - rect.right);
    const dy = Math.max(rect.top - y, 0, y - rect.bottom);
    return Math.hypot(dx, dy);
  };

  const defaultTarget = () => currentText ?? currentTable ?? currentBatch;

  const frameDefault = () => {
    const el = defaultTarget();
    if (el) frame.show(el, currentTable && !currentText ? 'table' : 'this will be added');
  };

  const closeMenu = () => {
    menuOpen = false;
    menu.style.display = 'none';
    frameDefault();
  };

  const cancelRetarget = () => {
    if (retargetTimer !== null) {
      clearTimeout(retargetTimer);
      retargetTimer = null;
    }
  };

  const hide = () => {
    cancelRetarget();
    closeMenu();
    root.style.display = 'none';
    frame.hide();
    currentTable = null;
    currentText = null;
    currentBatch = null;
    onTargetChange?.(false);
  };

  const cancelHide = () => {
    if (hideTimer !== null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  };

  const scheduleHide = () => {
    if (menuOpen) return; // an open menu waits for a choice, however long that takes
    if (hideTimer === null) hideTimer = window.setTimeout(hide, HIDE_DELAY_MS);
  };

  const handleMove = (event: MouseEvent) => {
    const target = event.target as Element | null;

    if (target && root.contains(target)) {
      cancelHide(); // the pointer is on the badge: it stays until used
      cancelRetarget(); // reaching it commits to the current target, not a pending one
      return;
    }
    if (menuOpen) return; // don't re-aim while the user is choosing

    const table = findTableAncestor(target);
    const text = findTextTarget(target);
    const batch = findBatchTarget(target);

    if (!table && !text && !batch) {
      cancelRetarget(); // whatever was about to be picked up next no longer applies
      scheduleHide();
      return;
    }

    cancelHide();

    const visible = root.style.display !== 'none';
    const sameTarget = visible && table === currentTable && text === currentText && batch === currentBatch;

    // Moving around inside the element you are already aiming at must not drag
    // the badge along, or it would flee from every attempt to click it.
    if (sameTarget) {
      cancelRetarget(); // back on the locked target — whatever was pending is stale
      return;
    }

    // The badge is offset from the cursor and may sit over a different element;
    // reaching for it crosses that element, which must not re-aim the capture.
    if (visible && distanceToBadge(event.clientX, event.clientY) < APPROACH_MARGIN_PX) return;

    const commit = () => {
      retargetTimer = null;
      if (menuOpen) return; // the menu opened while this was pending — too late to swap targets
      currentTable = table;
      currentText = text;
      currentBatch = batch;
      root.style.display = 'flex';
      moveTo(event.clientX + CURSOR_OFFSET_PX, event.clientY + CURSOR_OFFSET_PX);
      frameDefault();
      onTargetChange?.(true);
    };

    if (!visible) {
      commit(); // first appearance — show it immediately, nothing to steal focus from yet
      return;
    }

    // A target is already locked in and shown; only swap it for a new one once
    // the cursor has actually settled on that new element for a beat, so
    // passing over a neighbour on the way to the Add button doesn't silently
    // steal the target out from under you.
    cancelRetarget();
    retargetTimer = window.setTimeout(commit, RETARGET_DEBOUNCE_MS);
  };

  const handleScroll = () => {
    // the page moved under a badge pinned to viewport coordinates
    if (root.style.display !== 'none') hide();
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
    textItem.style.display = currentText ? 'flex' : 'none';
    // Batch nodes can be recorded on anything the badge is currently aimed
    // at — table, text, or a plain control — so they're never hidden.
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

  const handleBatch = (event: MouseEvent, kind: BatchKind) => {
    const el = currentBatch ?? currentText ?? currentTable;
    choose(event, () => el && onAddBatch(el, kind));
  };

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') hide();
  };

  const handleOutsideClick = (event: MouseEvent) => {
    if (menuOpen && !root.contains(event.target as Node)) hide();
  };

  // The frame no longer changes per menu item on hover — it used to preview
  // each option's own target (the whole table for "Table data" vs. just a
  // cell for "Text value"), but with several options meaning several
  // possibly-different elements, that made the outline flip around while you
  // were still choosing. One fixed frame for the whole time the menu is open
  // is what "locked" actually means here.
  const batchKinds: BatchKind[] = ['input', 'click', 'search', 'extract'];
  batchKinds.forEach((kind) => {
    batchItems[kind].addEventListener('click', (event) => handleBatch(event, kind), true);
  });

  trigger.addEventListener('click', handleTriggerClick, true);
  tableItem.addEventListener('click', handleTable, true);
  textItem.addEventListener('click', handleText, true);
  imageItem.addEventListener('click', handleImage, true);
  document.addEventListener('mousemove', handleMove, true);
  document.addEventListener('keydown', handleKeydown, true);
  document.addEventListener('click', handleOutsideClick, true);
  window.addEventListener('scroll', handleScroll, true);

  return () => {
    cancelHide();
    cancelRetarget();
    frame.remove();
    document.removeEventListener('mousemove', handleMove, true);
    document.removeEventListener('keydown', handleKeydown, true);
    document.removeEventListener('click', handleOutsideClick, true);
    window.removeEventListener('scroll', handleScroll, true);
    root.remove();
  };
}
