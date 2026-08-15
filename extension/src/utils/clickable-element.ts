const CLICKABLE_TAGS = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY']);
const CLICKABLE_ROLES = new Set(['button', 'link', 'checkbox', 'radio', 'menuitem', 'tab', 'switch']);
const MAX_DEPTH = 8;

// Walks up from the raw hover/click target to the nearest element that actually
// behaves like a clickable control — so hovering an icon *inside* a button
// highlights (and records) the button, not the icon.
export function findClickableAncestor(el: Element | null): HTMLElement | null {
  let current = el;

  for (let depth = 0; current && depth < MAX_DEPTH; depth++) {
    if (current instanceof HTMLElement) {
      if (CLICKABLE_TAGS.has(current.tagName)) return current;

      const role = current.getAttribute('role');
      if (role && CLICKABLE_ROLES.has(role)) return current;

      if (current.hasAttribute('onclick')) return current;
      if (current.tabIndex >= 0 && current !== document.body) return current;
      if (window.getComputedStyle(current).cursor === 'pointer') return current;
    }
    current = current.parentElement;
  }

  return el instanceof HTMLElement ? el : null;
}

// For "pick a table" mode: walk up to the nearest <table>, regardless of
// which cell/row the user actually clicked.
export function findTableAncestor(el: Element | null): HTMLTableElement | null {
  let current = el;
  for (let depth = 0; current && depth < MAX_DEPTH; depth++) {
    if (current instanceof HTMLTableElement) return current;
    current = current.parentElement;
  }
  return null;
}
