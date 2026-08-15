const TEST_ATTRIBUTES = ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa', 'data-automation-id'];
const MAX_PATH_DEPTH = 8;

// Framework-generated identifiers change on every build or render, so a
// selector built on them looks specific but breaks on the next visit.
const GENERATED_TOKEN = /(^|[-_])(?:[0-9a-f]{6,}|[a-z0-9]{9,})($|[-_])|^(?:css|sc|jss|emotion|mui|ng|_ngcontent|ember)[-_]/i;

// Classes that describe the moment rather than the element: present while
// hovered/open/selected and gone a second later.
const STATE_CLASS = /^(?:is-|has-)?(?:active|selected|open|closed|focus(?:ed)?|hover|disabled|checked|expanded|collapsed|show|shown|hidden|visible|current|loading|dragging|sticky|pressed)$/i;

function isStableToken(token: string): boolean {
  return token.length >= 2 && token.length <= 40 && !GENERATED_TOKEN.test(token) && !/^\d+$/.test(token);
}

function matchesOnly(selector: string, el: Element): boolean {
  try {
    const found = el.ownerDocument.querySelectorAll(selector);
    return found.length === 1 && found[0] === el;
  } catch {
    return false; // malformed selector (odd characters in an attribute value)
  }
}

function attributeSelector(el: Element, attribute: string): string | null {
  const value = el.getAttribute(attribute);
  if (!value || value.length > 100) return null;
  return `${el.tagName.toLowerCase()}[${attribute}="${CSS.escape(value).replace(/\\/g, '')}"]`;
}

function stableClassSelector(el: Element): string | null {
  const classes = Array.from(el.classList).filter((c) => isStableToken(c) && !STATE_CLASS.test(c));
  if (classes.length === 0) return null;
  return `${el.tagName.toLowerCase()}${classes.map((c) => `.${CSS.escape(c)}`).join('')}`;
}

function nthOfType(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const parent = el.parentElement;
  if (!parent) return tag;

  const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
  return siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(el) + 1})` : tag;
}

// Walks up until the path is pinned to something identifiable, so the selector
// survives changes elsewhere on the page instead of floating free.
function anchoredPath(el: Element): string | null {
  const parts: string[] = [];
  let current: Element | null = el;

  for (let depth = 0; current && depth < MAX_PATH_DEPTH; depth++) {
    parts.unshift(nthOfType(current));

    const parent: Element | null = current.parentElement;
    if (!parent || parent.tagName === 'BODY' || parent.tagName === 'HTML') {
      return `body > ${parts.join(' > ')}`;
    }

    const anchor = anchorSelector(parent);
    if (anchor) {
      const candidate = `${anchor} > ${parts.join(' > ')}`;
      if (matchesOnly(candidate, el)) return candidate;
    }

    current = parent;
  }

  return null;
}

// A selector for an ancestor worth anchoring to: something named, not positional.
function anchorSelector(el: Element): string | null {
  if (el.id && isStableToken(el.id) && matchesOnly(`#${CSS.escape(el.id)}`, el)) return `#${CSS.escape(el.id)}`;

  for (const attribute of TEST_ATTRIBUTES) {
    const candidate = attributeSelector(el, attribute);
    if (candidate && matchesOnly(candidate, el)) return candidate;
  }

  const byClass = stableClassSelector(el);
  if (byClass && matchesOnly(byClass, el)) return byClass;

  return null;
}

// Ordered best-first, every one verified to match this element and nothing else.
export function generateSelectorCandidates(el: Element): string[] {
  const candidates: string[] = [];
  const add = (selector: string | null) => {
    if (selector && !candidates.includes(selector) && matchesOnly(selector, el)) candidates.push(selector);
  };

  if (el.id && isStableToken(el.id)) add(`#${CSS.escape(el.id)}`);
  for (const attribute of TEST_ATTRIBUTES) add(attributeSelector(el, attribute));

  add(attributeSelector(el, 'name'));
  add(attributeSelector(el, 'aria-label'));
  add(attributeSelector(el, 'placeholder'));
  add(attributeSelector(el, 'title'));
  add(attributeSelector(el, 'alt'));
  if (el.tagName === 'A') add(attributeSelector(el, 'href'));
  add(stableClassSelector(el));
  add(anchoredPath(el));

  // last resort: a positional path, which at least resolves today
  if (candidates.length === 0) {
    const parts: string[] = [];
    let current: Element | null = el;
    while (current && current.tagName !== 'BODY' && parts.length < MAX_PATH_DEPTH) {
      parts.unshift(nthOfType(current));
      current = current.parentElement;
    }
    candidates.push(`body > ${parts.join(' > ')}`);
  }

  return candidates;
}

export function generateSelector(el: Element): string {
  return generateSelectorCandidates(el)[0];
}
