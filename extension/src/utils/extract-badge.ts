import { findTableAncestor, findClickableAncestor } from './clickable-element';
import { hasNonPositionalSelector } from './selector-utils';
import { markAsExtensionUi, isExtensionUi } from './ui-marker';
import { findNexacroComponent, findNexacroGrid, isNexacroVirtualCursor } from './nexacro';

const BADGE_ID = '__browser_agent_add_badge__';
// A short price/status/cell fits well under the old 300, but a product
// description, a review, or a multi-line detail card routinely runs longer —
// those were silently un-capturable (findTextTarget returned null, no "Text
// value" option at all) purely because of this cap, not because the element
// wasn't a reasonable thing to capture.
const MAX_TEXT_LENGTH = 800;
// Fallback size for the very first paint, before the menu has ever been
// measured — matches roughly what it renders at once populated, so the
// screen-edge clamp below has a sane box to work with immediately.
const MENU_FALLBACK_WIDTH_PX = 190;
const MENU_FALLBACK_HEIGHT_PX = 220;

export type BatchKind = 'input' | 'click' | 'search' | 'extract';

export interface BadgeCallbacks {
  onAddTable: (table: HTMLElement) => void;
  onAddText: (el: HTMLElement) => void;
  onAddImage: (el: HTMLElement) => void;
  onAddInput: (el: HTMLElement) => void;
  onAddHover: (el: HTMLElement) => void;
  onAddBatch: (el: HTMLElement, kind: BatchKind) => void;
  /** Fires while the menu is open (or once it closes) — lets the caller mute the plain hover outline so it doesn't double up with this component's own frame. */
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

const IMAGE_TAGS = new Set(['IMG', 'PICTURE', 'CANVAS', 'VIDEO', 'AUDIO']);

// A plain product photo, avatar, or banner has no text and is not a batch
// control either, so without its own check it matched none of the finders
// in this file and the badge never appeared over it at all — "Image of this
// area" was reachable only when the same spot happened to also be a
// text/table/batch target. role="img" covers the same gap for anything that
// isn't a native media tag at all — an icon font glyph or a CSS
// background-image div marked accessible that way.
function findImageTarget(el: Element | null): HTMLElement | null {
  if (!(el instanceof HTMLElement)) return null;
  if (isExtensionUi(el)) return null;
  if (IMAGE_TAGS.has(el.tagName)) return el;
  if (el.getAttribute('role') === 'img') return el;
  // A bare div with its picture set via CSS background-image, not an <img>
  // tag — confirmed on a live Nexacro app, where nearly every icon/logo/
  // photo on the page renders exactly this way (Static components). url(...)
  // specifically, not a gradient function — also a valid background-image
  // value, but not a photo worth screenshotting.
  if (/^url\(/.test(getComputedStyle(el).backgroundImage)) return el;
  return null;
}

// Batch Input/Click/Search target form controls and buttons, most of which
// have no text of their own and so never match findTextTarget above.
// LABEL matters on its own, not just as a fallback ancestor: the common
// custom-checkbox/radio markup hides the real <input> and shows a styled
// <span> next to it inside a <label> — that span is a sibling of the input,
// not a descendant, so the input is never reachable by climbing parents from
// it, and the span itself usually carries none of onclick/role/tabindex.
// Recognizing the label directly is what makes hovering the visible part of
// that pattern land on something. SUMMARY is the native expand/collapse
// trigger for a <details> element — clickable-element.ts's general hover
// highlighter already recognized it, this file's own badge detection had
// fallen out of sync with that.
const BATCH_TAGS = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY']);
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
    // range and color are Pick-style controls (drag a slider, open a color
    // well) — batchInput's inferBatchInputType and the one-shot Add → Type
    // text step both assume a typed string is a meaningful thing to set,
    // which isn't true for these two the way it still is for date/time
    // (those do accept a typed ISO-ish string in every real browser).
    return ![
      'checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'image', 'hidden', 'range', 'color',
    ].includes(el.type);
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

// !important: same reason as the badge root/menu (createBadge) — a real
// Nexacro app forces every div to position:absolute globally. Without this,
// these two plain divs get pulled out of the menu's flex flow and pile up
// at its top-left corner instead of sitting in place between the buttons.
function styleMenuDivider(): HTMLDivElement {
  const divider = document.createElement('div');
  divider.style.setProperty('position', 'static', 'important');
  divider.style.margin = '4px 0';
  divider.style.borderTop = '1px solid #e5e9f0';
  return divider;
}

function styleMenuLabel(text: string): HTMLDivElement {
  const label = document.createElement('div');
  label.style.setProperty('position', 'static', 'important');
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
  // !important: confirmed on a real Nexacro app, which applies a global
  // `div { position: absolute }` rule (its own widgets are all absolutely-
  // positioned divs) — without this, that rule wins over the plain inline
  // style and the box stops behaving as position:fixed at all.
  box.style.setProperty('position', 'fixed', 'important');
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
  menu: HTMLDivElement;
  tableItem: HTMLButtonElement;
  textItem: HTMLButtonElement;
  imageItem: HTMLButtonElement;
  inputItem: HTMLButtonElement;
  hoverItem: HTMLButtonElement;
  batchItems: Record<BatchKind, HTMLButtonElement>;
}

function createBadge(): BadgeElements {
  document.getElementById(BADGE_ID)?.remove();

  // Just a positioned wrapper for the menu now — no floating trigger/stop
  // row tracking the cursor. Ctrl+Right-click opens the menu right where the
  // pointer already is, the same way a native context menu would, so there
  // is nothing left for this element to do but anchor it on screen.
  const root = document.createElement('div');
  root.id = BADGE_ID;
  markAsExtensionUi(root);
  // !important: same reason as the target frame's box above — a real
  // Nexacro app forces every div to position:absolute globally. Without
  // this, `menu` below (a normal in-flow child, no top/left of its own) gets
  // silently pulled out of flow, and root — sized only by its in-flow
  // content — collapses to 0x0 with nothing left to show the menu inside.
  root.style.setProperty('position', 'fixed', 'important');
  root.style.zIndex = '2147483647';
  root.style.display = 'none';
  root.style.pointerEvents = 'auto';
  root.style.transition = 'none';

  const menu = document.createElement('div');
  menu.dataset.baRole = 'menu';
  // Same rule would otherwise make this position:absolute too — pinning it
  // back to a normal in-flow box is what lets root size itself around it.
  menu.style.setProperty('position', 'static', 'important');
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
  const hoverItem = document.createElement('button');
  // Some tooltip/popover menus only render their contents once something
  // real triggers a hover — this records that trigger as its own step so
  // replay can re-open it before whatever comes next tries to act on it.
  hoverItem.textContent = '👆  Hover (opens a tooltip/menu)';
  [tableItem, textItem, imageItem, inputItem, hoverItem].forEach(styleMenuItem);

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
    hoverItem,
    styleMenuDivider(),
    styleMenuLabel('Batch'),
    ...batchKinds.map((kind) => batchItems[kind]),
  );
  root.append(menu);
  document.documentElement.appendChild(root);

  return { root, menu, tableItem, textItem, imageItem, inputItem, hoverItem, batchItems };
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

// Nexacro's virtual mouse cursor sits over whatever the pointer is actually
// on (confirmed on a live app: a 150x150 pointer-events:auto div near a text
// field), so the browser's own hit-testing lands on it first — same as a
// real click would. Hiding it from hit-testing for one elementFromPoint call
// finds what's actually underneath, the same trick used to click through
// any overlay; restoring pointer-events right after leaves the page exactly
// as it found it.
// Rides along with the pointer during recording and offers to capture whatever
// is under it, so extracting data never requires leaving the page.
export function attachExtractBadge({
  onAddTable,
  onAddText,
  onAddImage,
  onAddInput,
  onAddHover,
  onAddBatch,
  onTargetChange,
}: BadgeCallbacks): () => void {
  const { root, menu, tableItem, textItem, imageItem, inputItem, hoverItem, batchItems } = createBadge();
  const frame = createTargetFrame();

  let currentTable: HTMLElement | null = null;
  let currentText: HTMLElement | null = null;
  let currentBatch: HTMLElement | null = null;
  let currentImage: HTMLElement | null = null;
  // Set when the menu opens, compared against on every 'scroll' — some sites
  // (confirmed on a real Nexacro app) fire window scroll events continuously
  // as part of their own virtual-scroll/rendering machinery, with the real
  // document position never actually moving (scrollX/Y unchanged). Closing
  // on every one of those closed the menu within milliseconds of it ever
  // opening; only a genuine change in scroll position means the menu's
  // fixed-position coordinates have gone stale.
  let scrollAtOpen = { x: 0, y: 0 };
  let menuOpen = false;

  // Image first: findImageTarget only ever matches an actual img/picture/
  // canvas/video/audio or role="img" — a precise, unambiguous signal that
  // should never be shadowed by findBatchTarget's up-to-6-level climb to the
  // nearest clickable ancestor (a small icon sitting inside a clickable
  // card/row, extremely common in real UIs, used to hand back the whole
  // card instead of the icon).
  const defaultTarget = () => currentImage ?? currentText ?? currentTable ?? currentBatch;

  // Only ever called once per Ctrl+Right-click, not on every mousemove —
  // this used to also run continuously while the pointer crossed the page
  // (walking up to three ancestor chains per element) chasing a floating
  // trigger button that followed the cursor. That was measured cheap in
  // isolation, but at real mouse event rates it was still enough extra main-
  // thread work to read as stutter. The page now gets a plain, effectively
  // free CSS outline on hover (highlighter.ts, mouseover-driven) instead,
  // and this only does any work at all when the menu is actually opening.
  // findTableAncestor is a generic HTML heuristic (repeated sibling rows of
  // uniform shape, or a <table>/role="grid") that a real Nexacro Grid's own
  // DOM shape doesn't reliably satisfy — confirmed on a live Nexacro app,
  // where aiming at a cell offered no "Table data" option at all even though
  // extraction itself (locateTable, nexacroExtractGrid) already knows how to
  // resolve any cell up to the Grid that owns it and read its bound dataset.
  const computeTargets = (target: Element | null) => ({
    table: findTableAncestor(target) ?? findNexacroGrid(target)?.element ?? null,
    text: findTextTarget(target),
    batch: findBatchTarget(target),
    image: findImageTarget(target),
  });

  const hasAnyTarget = (t: ReturnType<typeof computeTargets>) => !!(t.table || t.text || t.batch || t.image);

  const areaOf = (el: Element): number => {
    const r = el.getBoundingClientRect();
    return r.width * r.height;
  };

  // The exact element under the pointer can be a purely decorative,
  // pointer-events:auto overlay with nothing of its own to capture, sitting
  // on top of a real control at the very same screen position — confirmed on
  // a real Nexacro app, where a background "card" panel behind a login form
  // (empty, no text/image, 330x333px) intercepted every click meant for the
  // email/password fields drawn at that same spot. elementsFromPoint returns
  // the full stack at that point, topmost first, so walking past the first
  // miss finds the real control instead of reporting "nothing here" just
  // because the very top layer happens to be decorative.
  //
  // Only table/image/batch count here, never text: findTextTarget accepts
  // anything with SOME descendant text anywhere inside it, which is exactly
  // right for the element the user actually pointed at (that's what they
  // meant to capture) but wrong for an ancestor merely turned up by this
  // walk — confirmed live, where a big wrapping container with an unrelated
  // caption buried somewhere inside it kept getting offered as "the text
  // here" for a click that landed on empty space nowhere near that caption.
  const hasAnyPreciseTarget = (t: ReturnType<typeof computeTargets>) => !!(t.table || t.batch || t.image);

  // A real control hiding under a decorative panel is never bigger than the
  // panel drawn around it — an "is it contained within the original miss"
  // check was tried instead and reverted: a top-level ancestor trivially
  // "contains" everything under it on the page, so it let this walk climb
  // all the way up to a full-screen wrapper and offer to screenshot the
  // entire page (which then replayed back blank, since that wrapper paints
  // nothing itself — all its content is positioned children elsewhere).
  // Rejecting anything larger than the original miss keeps the login-field
  // fix without inviting that one in.
  const resolveTarget = (target: Element | null, x: number, y: number): Element | null => {
    if (target && hasAnyTarget(computeTargets(target))) return target;
    const maxArea = target ? areaOf(target) : Infinity;
    for (const el of document.elementsFromPoint(x, y)) {
      if (el === target || isExtensionUi(el)) continue;
      if (areaOf(el) > maxArea) continue;
      if (hasAnyPreciseTarget(computeTargets(el))) return el;
    }
    return target;
  };

  const positionAt = (x: number, y: number) => {
    const width = root.offsetWidth || MENU_FALLBACK_WIDTH_PX;
    const height = root.offsetHeight || MENU_FALLBACK_HEIGHT_PX;
    root.style.left = `${Math.max(4, Math.min(x, window.innerWidth - width - 4))}px`;
    root.style.top = `${Math.max(4, Math.min(y, window.innerHeight - height - 4))}px`;
  };

  const hide = () => {
    menuOpen = false;
    root.style.display = 'none';
    frame.hide();
    currentTable = null;
    currentText = null;
    currentBatch = null;
    currentImage = null;
    onTargetChange?.(false);
  };

  const stop = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  // Shared by both triggers below: computes what the menu is aimed at and
  // shows it at the given point. Returns false (nothing shown) when nothing
  // under the pointer qualifies for any capture kind.
  const openMenuAt = (target: Element | null, x: number, y: number): boolean => {
    const targets = computeTargets(resolveTarget(target, x, y));
    if (!hasAnyTarget(targets) && target instanceof HTMLElement) {
      // Nothing precise matched anywhere under the pointer — the user's own
      // explicit ask is that Add still works here regardless, screenshotting
      // whatever is on screen. findClickableAncestor is the same resolution
      // the hover highlight already uses and always returns something for a
      // real element, so this makes "Add works" and "the hover outline
      // shows" the same guarantee instead of a purely decorative Nexacro
      // panel (no text, no background-image, not interactive) offering
      // nothing at all.
      targets.image = findClickableAncestor(target);
    }
    if (!hasAnyTarget(targets)) return false;

    currentTable = targets.table;
    currentText = targets.text;
    currentBatch = targets.batch;
    currentImage = targets.image;
    menuOpen = true;

    tableItem.style.display = currentTable ? 'flex' : 'none';
    textItem.style.display = currentText ? 'flex' : 'none';
    inputItem.style.display = isTypeable(currentBatch) ? 'flex' : 'none';
    // "Image of this area" means exactly that — the area drawn on screen,
    // whatever defaultTarget() below currently outlines, not necessarily a
    // real <img>/background-image — so like Batch, it's never hidden. Hiding
    // it whenever currentImage was empty was tried and reverted: the user's
    // own real use case is screenshotting a plain field with nothing that
    // findImageTarget would ever recognize as "an image" on its own.
    menu.style.display = 'flex';
    root.style.display = 'block';
    positionAt(x, y);
    scrollAtOpen = { x: window.scrollX, y: window.scrollY };

    const el = defaultTarget();
    if (el) frame.show(el, 'Selected');
    onTargetChange?.(true);
    return true;
  };

  // The normal path: a real context menu, not a button that has to be
  // hunted down first. Nothing tracks the cursor between clicks.
  const handleContextMenu = (event: MouseEvent) => {
    if (!event.ctrlKey) return;
    const target = realTarget(event);
    // stop() has to run before the isExtensionUi check below, not after:
    // handleMouseDown's own fallback (below) already opens the menu right
    // where the cursor is, so by the time this contextmenu event follows on
    // the same click, the cursor can already be sitting on top of that very
    // menu — making its own real target our own UI. Bailing out before
    // suppressing would leave the browser's native menu free to pop up over
    // the one we just opened, which is exactly what happened here.
    stop(event); // suppress the browser's own context menu unconditionally
    if (isExtensionUi(target)) return;
    // Nexacro renders its own mouse cursor as a real, pointer-events:auto
    // DOM element that tracks the pointer (confirmed live, near a text
    // field) — the browser's hit-testing lands on it first, same as a real
    // click would, so without this a click meant for whatever is
    // underneath instead captures "the mouse cursor icon". Hiding it and
    // re-resolving via elementFromPoint was tried and rejected: it lands on
    // some other unrelated container instead, and a wrong-but-plausible
    // target silently captured is worse than the menu not opening at all.
    if (isNexacroVirtualCursor(target)) return;
    if (menuOpen) return;
    openMenuAt(target, event.clientX, event.clientY);
  };

  // A fallback trigger for pages that block contextmenu outright: some
  // sites (confirmed on a real Nexacro grid) call preventDefault() on
  // mousedown for the right button specifically, which stops the browser
  // from ever synthesizing a contextmenu event at all — no listener on any
  // node can react to an event that never fires. mousedown itself always
  // still fires and still reports ctrlKey/button correctly (preventDefault
  // there only cancels default browser behavior like text selection, not
  // other listeners, and not a future event), so this opens the menu right
  // there instead of waiting for a contextmenu that may never come.
  //
  // stop() runs before the target is even checked (aside from our own UI):
  // confirmed on a real Nexacro TextField, right-clicking it while Ctrl is
  // held (unavoidable — that's the gesture) let the page's OWN mousedown
  // handler also fire — usually to focus/relay into whatever component is
  // really under the cursor, cursor-overlay included — after which Ctrl's
  // own OS-level key-repeat got routed into that field's onkeydown handler
  // on every repeat, which crashed on a bare modifier key, over and over,
  // for as long as the button stayed held. Stopping propagation here (this
  // listener sits on window, ahead of everything else in capture order)
  // keeps the page's own handler from ever seeing this click at all — this
  // has to happen even when the target turns out to be unusable (the
  // cursor overlay), since the page's own reaction is what starts the
  // crash chain, not whatever we do with the target afterward.
  const handleMouseDown = (event: MouseEvent) => {
    if (event.button !== 2 || !event.ctrlKey) return;
    const target = realTarget(event);
    if (isExtensionUi(target)) return;
    stop(event);
    if (isNexacroVirtualCursor(target)) return;
    openMenuAt(target, event.clientX, event.clientY);
  };

  const handleScroll = () => {
    if (!menuOpen) return;
    // Real change only — see scrollAtOpen's own comment for why this can't
    // just be "any scroll event at all closes the menu".
    if (window.scrollX !== scrollAtOpen.x || window.scrollY !== scrollAtOpen.y) hide();
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

  const handleHover = (event: MouseEvent) => {
    const el = defaultTarget();
    choose(event, () => el && onAddHover(el));
  };

  const handleBatch = (event: MouseEvent, kind: BatchKind) => {
    const el = currentBatch ?? currentText ?? currentTable;
    choose(event, () => el && onAddBatch(el, kind));
  };

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') hide();
  };

  const handleOutsideClick = (event: MouseEvent) => {
    const target = realTarget(event);
    if (menuOpen && (!target || !root.contains(target))) hide();
  };

  const batchKinds: BatchKind[] = ['input', 'click', 'search', 'extract'];
  batchKinds.forEach((kind) => {
    batchItems[kind].addEventListener('click', (event) => handleBatch(event, kind), true);
  });

  tableItem.addEventListener('click', handleTable, true);
  textItem.addEventListener('click', handleText, true);
  imageItem.addEventListener('click', handleImage, true);
  inputItem.addEventListener('click', handleInput, true);
  hoverItem.addEventListener('click', handleHover, true);
  // window, not document: some sites (confirmed on a real Nexacro app) install
  // their own capture-phase contextmenu listener directly on window and call
  // stopPropagation() there to silence the browser's native menu over their
  // widgets — which also silences a listener on document, since capture
  // order runs window before document. window still sees the event first
  // (same-node listeners aren't affected by another listener's
  // stopPropagation, only stopImmediatePropagation would do that), so
  // Ctrl+Right-click keeps working on pages like this instead of never
  // opening the menu at all. keydown/click move here too for the same
  // reason; scroll already lived on window.
  window.addEventListener('contextmenu', handleContextMenu, true);
  window.addEventListener('mousedown', handleMouseDown, true);
  window.addEventListener('keydown', handleKeydown, true);
  window.addEventListener('click', handleOutsideClick, true);
  window.addEventListener('scroll', handleScroll, true);

  return () => {
    frame.remove();
    window.removeEventListener('contextmenu', handleContextMenu, true);
    window.removeEventListener('mousedown', handleMouseDown, true);
    window.removeEventListener('keydown', handleKeydown, true);
    window.removeEventListener('click', handleOutsideClick, true);
    window.removeEventListener('scroll', handleScroll, true);
    root.remove();
  };
}
