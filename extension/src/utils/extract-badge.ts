import { findTableAncestor, findClickableAncestor } from './clickable-element';
import { hasNonPositionalSelector } from './selector-utils';
import { markAsExtensionUi, isExtensionUi } from './ui-marker';
import { findNexacroComponent } from './nexacro';

const BADGE_ID = '__browser_agent_add_badge__';
// A short price/status/cell fits well under the old 300, but a product
// description, a review, or a multi-line detail card routinely runs longer —
// those were silently un-capturable (findTextTarget returned null, no "Text
// value" option at all) purely because of this cap, not because the element
// wasn't a reasonable thing to capture.
const MAX_TEXT_LENGTH = 800;
const HIDE_DELAY_MS = 4000;
const CURSOR_OFFSET_PX = 18;
// The badge appears offset diagonally by CURSOR_OFFSET_PX in both axes, so
// the row sits ~25px (hypot(18,18)) from the cursor the instant it shows up.
// This margin used to be 34 — bigger than that starting gap — so the "don't
// re-aim while reaching for the badge" guard below was true from the very
// first frame and stayed true through anything short of a large move,
// reading as the frame refusing to track the cursor at all. It only needs to
// cover the last short hop onto the row itself, which is well under 25px.
const APPROACH_MARGIN_PX = 12;
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

const IMAGE_TAGS = new Set(['IMG', 'PICTURE', 'CANVAS', 'VIDEO']);

// A plain product photo, avatar, or banner has no text and is not a batch
// control either, so without its own check it matched none of the finders
// in this file and the badge never appeared over it at all — "Image of this
// area" was reachable only when the same spot happened to also be a
// text/table/batch target.
function findImageTarget(el: Element | null): HTMLElement | null {
  if (!(el instanceof HTMLElement)) return null;
  if (isExtensionUi(el)) return null;
  return IMAGE_TAGS.has(el.tagName) ? el : null;
}

// Batch Input/Click/Search target form controls and buttons, most of which
// have no text of their own and so never match findTextTarget above.
// LABEL matters on its own, not just as a fallback ancestor: the common
// custom-checkbox/radio markup hides the real <input> and shows a styled
// <span> next to it inside a <label> — that span is a sibling of the input,
// not a descendant, so the input is never reachable by climbing parents from
// it, and the span itself usually carries none of onclick/role/tabindex.
// Recognizing the label directly is what makes hovering the visible part of
// that pattern land on something.
const BATCH_TAGS = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL']);
// Beyond the four obvious ones: modern component libraries build their
// controls out of divs and lean entirely on the role to say what they are,
// so limiting this to button/link/checkbox/radio left most of a real app's
// interactive surface unrecognized by the badge.
const BATCH_ROLES = new Set([
  'button', 'link', 'checkbox', 'radio', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'tab', 'switch', 'option', 'combobox', 'listbox', 'searchbox', 'textbox', 'spinbutton',
  'slider', 'treeitem',
]);

// A div that a framework wired up by hand still behaves like a control to the
// user, and is exactly what they will point the badge at. These are the marks
// of that, cheapest test first — getComputedStyle is last because it forces
// style resolution, and this runs on every mousemove. checkCursor is false
// for every ancestor above the original hover target: a cursor:pointer rule
// belongs to the element the mouse is actually over, not something worth
// paying a style recalculation for at every one of up to 6 climbed levels.
function isInteractiveElement(el: HTMLElement, checkCursor: boolean): boolean {
  if (BATCH_TAGS.has(el.tagName)) return true;

  const role = el.getAttribute('role');
  if (role && BATCH_ROLES.has(role)) return true;

  if (el.hasAttribute('onclick')) return true;
  if (el.isContentEditable) return true;
  if (el.tabIndex >= 0 && el !== document.body) return true;

  return checkCursor && window.getComputedStyle(el).cursor === 'pointer';
}

function findBatchTarget(el: Element | null): HTMLElement | null {
  // Nexacro's own DOM element for a component rarely has a matching tag/role,
  // so it needs its own check up front.
  const nexacro = findNexacroComponent(el);
  if (nexacro) return nexacro.element;

  let current = el;

  for (let depth = 0; current && depth < 6; depth++) {
    if (current instanceof HTMLElement && !isExtensionUi(current) && isInteractiveElement(current, depth === 0)) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

// "Type text" only makes sense for a field the user can actually type into —
// not every button/link findBatchTarget also matches.
const TYPEABLE_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);

function isTypeable(el: Element | null): boolean {
  const nexacro = findNexacroComponent(el);
  if (nexacro) return !/button/i.test(nexacro.type);

  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    return !['checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'image', 'hidden'].includes(el.type);
  }
  // Rich-text editors and framework inputs are contenteditable divs or
  // role="textbox" — they take typed text exactly like a real field, and
  // findBatchTarget now offers them, so "Type text" has to recognize them too.
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  const role = el?.getAttribute('role');
  return !!role && TYPEABLE_ROLES.has(role);
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
  // Without this, a page with its own `* { transition: ... }` rule (common
  // in CSS resets/frameworks) makes this box slide to its new position
  // instead of jumping there — the position update in JS is instant, but
  // what the user sees animates over the page's own transition duration,
  // reading as the frame lagging behind a fast-moving cursor.
  box.style.transition = 'none';

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
  // Same reasoning as the target frame — a page's own transition rule must
  // not animate this badge's position as it follows the cursor.
  root.style.transition = 'none';

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

// Composed events (mousemove, click, contextmenu) are retargeted for any
// listener sitting outside a shadow tree the real hit element lives inside —
// per the DOM spec, event.target collapses to that tree's host instead of
// the actual innermost element. On a page that puts a shadow boundary
// somewhere between the document and the pointer's true target,
// event.target can end up being some unrelated host element even while the
// pointer is squarely over our own badge, making every root.contains(target)
// check below silently and permanently fail. composedPath()[0] reports the
// true innermost element regardless of any shadow boundaries in the way, so
// use that instead of event.target everywhere a real hit-test is needed.
function realTarget(event: Event): Element | null {
  const path = event.composedPath();
  return (path[0] as Element | undefined) ?? (event.target as Element | null);
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
  let currentImage: HTMLElement | null = null;
  let hideTimer: number | null = null;
  let menuOpen = false;
  let anchorX = 0;
  let anchorY = 0;
  // The raw element a mousemove last landed on, independent of what it
  // resolved to. A real mouse fires many move events without ever leaving
  // the element under the pointer (sub-pixel jitter, a slow drag) — as long
  // as that element hasn't changed, computeTargets cannot have anything new
  // to report, so re-walking three ancestor chains and re-running selector
  // uniqueness checks on every one of those events is pure waste. That waste
  // was still enough, at real mouse event rates, to read as stutter even
  // though each individual computeTargets call was already cheap in
  // isolation.
  let lastRawTarget: Element | null = null;

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

  const defaultTarget = () => currentText ?? currentTable ?? currentBatch ?? currentImage;

  // The label teaches the Ctrl+Right-click shortcut rather than restating
  // "this will be added" — the outline itself already says that.
  const frameDefault = () => {
    const el = defaultTarget();
    if (el) frame.show(el, 'Ctrl+Right-click to add');
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
    currentImage = null;
    // Without this, re-hovering the exact same element right after it was
    // captured (a very common flow: pick "Text value", the mouse hasn't
    // moved yet) would still match lastRawTarget from before hide() ran and
    // the steady-hover skip above would bail before ever recomputing —
    // leaving the badge permanently gone until the pointer visits a
    // different element first.
    lastRawTarget = null;
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

  // Computed once per call and reused for both the "did anything change"
  // comparison and the actual state update — the earlier version of this
  // function (handleMove) called these three finders once to compare against
  // the current target and, on a mismatch, called them again to know what to
  // switch to. That doubled the exact per-event cost the whole synchronous,
  // un-batched design (see the comment below) exists to keep low.
  const computeTargets = (target: Element | null) => ({
    table: findTableAncestor(target),
    text: findTextTarget(target),
    batch: findBatchTarget(target),
    image: findImageTarget(target),
  });

  // Shared by continuous hover tracking (handleMove) and the one-shot
  // Ctrl+Right-click trigger (handleContextMenu below) — both need the same
  // "aim the badge at this, right here" state update once a target is known.
  const applyTargets = (
    event: MouseEvent,
    {
      table,
      text,
      batch,
      image,
    }: { table: HTMLElement | null; text: HTMLElement | null; batch: HTMLElement | null; image: HTMLElement | null },
  ): void => {
    cancelHide();
    currentTable = table;
    currentText = text;
    currentBatch = batch;
    currentImage = image;
    root.style.display = 'flex';
    moveTo(event.clientX + CURSOR_OFFSET_PX, event.clientY + CURSOR_OFFSET_PX);
    frameDefault();
    onTargetChange?.(true);
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
    const target = realTarget(event);

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

    if (target === lastRawTarget) return;
    lastRawTarget = target;

    const targets = computeTargets(target);
    if (!targets.table && !targets.text && !targets.batch && !targets.image) {
      scheduleHide();
      return;
    }

    const visible = root.style.display !== 'none';
    const sameTarget =
      visible &&
      targets.table === currentTable &&
      targets.text === currentText &&
      targets.batch === currentBatch &&
      targets.image === currentImage;

    // Moving around inside the element you are already aiming at must not drag
    // the badge along, or it would flee from every attempt to click it.
    if (sameTarget) return;

    // The badge is offset from the cursor and may sit over a different element;
    // reaching for it crosses that element, which must not re-aim the capture.
    if (visible && distanceToBadge(event.clientX, event.clientY) < APPROACH_MARGIN_PX) return;

    applyTargets(event, targets);
  };

  // A right-click held with Ctrl opens the Add menu directly at the pointer,
  // no travel to the badge required — for anyone who would rather keep both
  // hands near the keyboard/mouse buttons than chase a floating button.
  const handleContextMenu = (event: MouseEvent) => {
    const target = realTarget(event);
    if (!event.ctrlKey || isExtensionUi(target)) return;

    stop(event); // suppress the browser's own context menu
    const targets = computeTargets(target);
    if (!targets.table && !targets.text && !targets.batch && !targets.image) return;

    applyTargets(event, targets);
    openMenu();
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

  // Shared by the trigger button and the Ctrl+Right-click shortcut — both
  // land here once a target is already aimed at.
  const openMenu = () => {
    cancelHide();
    menuOpen = true;
    tableItem.style.display = currentTable ? 'flex' : 'none';
    textItem.style.display = currentText ? 'flex' : 'none';
    inputItem.style.display = isTypeable(currentBatch) ? 'flex' : 'none';
    // Batch nodes can be recorded on anything the badge is currently aimed
    // at — table, text, or a plain control — so they're never hidden.
    menu.style.display = 'flex';
  };

  const handleTriggerClick = (event: MouseEvent) => {
    stop(event);
    if (menuOpen) {
      closeMenu();
      return;
    }
    openMenu();
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
    const target = realTarget(event);
    if (menuOpen && (!target || !root.contains(target))) hide();
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
  document.addEventListener('contextmenu', handleContextMenu, true);
  document.addEventListener('keydown', handleKeydown, true);
  document.addEventListener('click', handleOutsideClick, true);
  window.addEventListener('scroll', handleScroll, true);

  return () => {
    cancelHide();
    frame.remove();
    document.removeEventListener('mousemove', handleMove, true);
    document.removeEventListener('contextmenu', handleContextMenu, true);
    document.removeEventListener('keydown', handleKeydown, true);
    document.removeEventListener('click', handleOutsideClick, true);
    window.removeEventListener('scroll', handleScroll, true);
    root.remove();
  };
}
