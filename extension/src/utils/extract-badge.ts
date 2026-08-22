import { findTableAncestor, findClickableAncestor } from './clickable-element';
import { hasNonPositionalSelector } from './selector-utils';
import { markAsExtensionUi, isExtensionUi } from './ui-marker';
import { findNexacroComponent } from './nexacro';

const BADGE_ID = '__browser_agent_add_badge__';
const MAX_TEXT_LENGTH = 300;
const HIDE_DELAY_MS = 4000;
const CURSOR_OFFSET_PX = 18;
// The badge only needs to hold still over the short hop from the element to
// itself; freezing over a wider radius would also swallow moves to a
// neighbouring element, silently capturing the wrong thing.
const APPROACH_MARGIN_PX = 34;
// Clearing out to roughly this far from the open menu reads as "I'm done
// with this, let me look elsewhere" rather than just a wobble mid-choice.
const MENU_DISMISS_DISTANCE_PX = 120;

export type BatchKind = 'input' | 'click' | 'search' | 'extract';

export interface BadgeCallbacks {
  onAddTable: (table: HTMLElement) => void;
  onAddText: (el: HTMLElement) => void;
  onAddImage: (el: HTMLElement) => void;
  onAddInput: (el: HTMLElement) => void;
  onAddBatch: (el: HTMLElement, kind: BatchKind) => void;
  onStop: () => void;
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
  return !hasNonPositionalSelector(el);
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
  // Nexacro's own DOM element for a component rarely has a matching tag/role
  // (BATCH_TAGS/BATCH_ROLES below), so it needs its own check up front.
  const nexacro = findNexacroComponent(el);
  if (nexacro) return nexacro.element;

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

// "Type text" only makes sense for a field the user can actually type into —
// not every button/link findBatchTarget also matches.
function isTypeable(el: Element | null): boolean {
  const nexacro = findNexacroComponent(el);
  if (nexacro) return !/button/i.test(nexacro.type);

  if (!(el instanceof HTMLTextAreaElement)) {
    if (!(el instanceof HTMLInputElement)) return false;
    if (['checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'image', 'hidden'].includes(el.type)) return false;
  }
  return true;
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
  row: HTMLDivElement;
  trigger: HTMLButtonElement;
  stopBtn: HTMLButtonElement;
  menu: HTMLDivElement;
  tableItem: HTMLButtonElement;
  textItem: HTMLButtonElement;
  imageItem: HTMLButtonElement;
  inputItem: HTMLButtonElement;
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

  // Sits right beside Add — the counting bubble that used to float in the
  // corner is gone, so this is the only on-page way to stop a recording now.
  const stopBtn = document.createElement('button');
  stopBtn.type = 'button';
  stopBtn.dataset.baRole = 'stop';
  stopBtn.title = 'Stop recording';
  stopBtn.textContent = '⏹';
  stopBtn.style.border = 'none';
  stopBtn.style.borderRadius = '999px';
  stopBtn.style.width = '28px';
  stopBtn.style.height = '28px';
  stopBtn.style.flexShrink = '0';
  stopBtn.style.display = 'flex';
  stopBtn.style.alignItems = 'center';
  stopBtn.style.justifyContent = 'center';
  stopBtn.style.background = '#dc2626';
  stopBtn.style.color = '#fff';
  stopBtn.style.fontSize = '11px';
  stopBtn.style.cursor = 'pointer';
  stopBtn.style.boxShadow = '0 2px 10px rgba(220, 38, 38, 0.45)';

  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.alignItems = 'center';
  row.style.gap = '6px';
  row.append(trigger, stopBtn);

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
  const inputItem = document.createElement('button');
  inputItem.textContent = '⌨️  Type text';
  [tableItem, textItem, imageItem, inputItem].forEach(styleMenuItem);

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
    inputItem,
    styleMenuDivider(),
    styleMenuLabel('Batch'),
    ...batchKinds.map((kind) => batchItems[kind]),
  );
  root.append(row, menu);
  document.documentElement.appendChild(root);

  return { root, row, trigger, stopBtn, menu, tableItem, textItem, imageItem, inputItem, batchItems };
}

// Rides along with the pointer during recording and offers to capture whatever
// is under it, so extracting data never requires leaving the page.
export function attachExtractBadge({
  onAddTable,
  onAddText,
  onAddImage,
  onAddInput,
  onAddBatch,
  onStop,
  onTargetChange,
}: BadgeCallbacks): () => void {
  const { root, row, trigger, stopBtn, menu, tableItem, textItem, imageItem, inputItem, batchItems } = createBadge();
  const frame = createTargetFrame();

  let currentTable: HTMLElement | null = null;
  let currentText: HTMLElement | null = null;
  let currentBatch: HTMLElement | null = null;
  let hideTimer: number | null = null;
  let menuOpen = false;
  let anchorX = 0;
  let anchorY = 0;

  const moveTo = (x: number, y: number) => {
    const width = row.offsetWidth || 110;
    const height = row.offsetHeight || 28;
    anchorX = Math.max(4, Math.min(x, window.innerWidth - width - 4));
    anchorY = Math.max(4, Math.min(y, window.innerHeight - height - 4));
    root.style.left = `${anchorX}px`;
    root.style.top = `${anchorY}px`;
  };

  // distance to the Add+Stop row, zero when the pointer is inside it
  const distanceToBadge = (x: number, y: number) => {
    const rect = row.getBoundingClientRect();
    const dx = Math.max(rect.left - x, 0, x - rect.right);
    const dy = Math.max(rect.top - y, 0, y - rect.bottom);
    return Math.hypot(dx, dy);
  };

  // distance to the whole badge+menu footprint — used to notice the user has
  // clearly moved on, as opposed to just not being exactly over it
  const distanceToRoot = (x: number, y: number) => {
    const rect = root.getBoundingClientRect();
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

  const hide = () => {
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

  // Deferring this to a requestAnimationFrame callback was tried, on the
  // theory that a real mouse fires far more mousemove events than the screen
  // repaints — but rAF scheduled from inside a mousemove handler runs on the
  // *next* frame, not the current one, adding a real ~16ms of latency on top
  // of whatever the browser's own event dispatch already costs. That is
  // invisible while crawling the pointer slowly but reads as a visible gap
  // between the cursor and the frame during a fast sweep, which is exactly
  // backwards from the goal. The per-call cost here (ancestor walks, selector
  // checks) was separately measured at low single-digit milliseconds even on
  // a pathological page, so there was never a processing-time problem to
  // solve by batching — handling every event immediately, synchronously, is
  // both simpler and actually lower latency.
  const handleMove = (event: MouseEvent) => {
    const target = event.target as Element | null;

    if (target && root.contains(target)) {
      cancelHide(); // the pointer is on the badge: it stays until used
      return;
    }

    // Locked the instant Add is clicked, not just once a choice is made — the
    // whole point is that nothing underneath can change while you're picking.
    // Moving well clear of the menu without clicking anything backs out of
    // that lock too, so exploring the page freely doesn't require a click
    // first.
    if (menuOpen) {
      if (distanceToRoot(event.clientX, event.clientY) < MENU_DISMISS_DISTANCE_PX) return;
      closeMenu();
    }

    const table = findTableAncestor(target);
    const text = findTextTarget(target);
    const batch = findBatchTarget(target);

    if (!table && !text && !batch) {
      scheduleHide();
      return;
    }

    cancelHide();

    const visible = root.style.display !== 'none';
    const sameTarget = visible && table === currentTable && text === currentText && batch === currentBatch;

    // Moving around inside the element you are already aiming at must not drag
    // the badge along, or it would flee from every attempt to click it.
    if (sameTarget) return;

    // The badge is offset from the cursor and may sit over a different element;
    // reaching for it crosses that element, which must not re-aim the capture.
    if (visible && distanceToBadge(event.clientX, event.clientY) < APPROACH_MARGIN_PX) return;

    currentTable = table;
    currentText = text;
    currentBatch = batch;
    root.style.display = 'flex';
    moveTo(event.clientX + CURSOR_OFFSET_PX, event.clientY + CURSOR_OFFSET_PX);
    frameDefault();
    onTargetChange?.(true);
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
    inputItem.style.display = isTypeable(currentBatch) ? 'flex' : 'none';
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

  // "Image of this area" means the area drawn on screen — so it takes exactly
  // what the outline is around. Preferring the table here instead used to
  // photograph a whole table when the outline was on one of its cells.
  const handleImage = (event: MouseEvent) => {
    const el = defaultTarget();
    choose(event, () => el && onAddImage(el));
  };

  // A one-shot "fill this field with X" step — distinct from Batch → Input,
  // which reads a different value per dataset row instead of one fixed value.
  const handleInput = (event: MouseEvent) => {
    const el = currentBatch;
    choose(event, () => el && isTypeable(el) && onAddInput(el));
  };

  const handleBatch = (event: MouseEvent, kind: BatchKind) => {
    const el = currentBatch ?? currentText ?? currentTable;
    choose(event, () => el && onAddBatch(el, kind));
  };

  const handleStop = (event: MouseEvent) => {
    stop(event);
    onStop();
    hide(); // instant feedback — the real teardown lands shortly after via SET_RECORDING
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
  stopBtn.addEventListener('click', handleStop, true);
  tableItem.addEventListener('click', handleTable, true);
  textItem.addEventListener('click', handleText, true);
  imageItem.addEventListener('click', handleImage, true);
  inputItem.addEventListener('click', handleInput, true);
  document.addEventListener('mousemove', handleMove, true);
  document.addEventListener('keydown', handleKeydown, true);
  document.addEventListener('click', handleOutsideClick, true);
  window.addEventListener('scroll', handleScroll, true);

  return () => {
    cancelHide();
    frame.remove();
    document.removeEventListener('mousemove', handleMove, true);
    document.removeEventListener('keydown', handleKeydown, true);
    document.removeEventListener('click', handleOutsideClick, true);
    window.removeEventListener('scroll', handleScroll, true);
    root.remove();
  };
}
