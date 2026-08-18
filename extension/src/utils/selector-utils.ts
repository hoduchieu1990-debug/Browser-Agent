const TEST_ATTRIBUTES = ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa', 'data-automation-id'];
const MAX_PATH_DEPTH = 8;

// Framework-generated identifiers change on every build or render, so a
// selector built on them looks specific but breaks on the next visit.
const GENERATED_TOKEN = /(^|[-_])(?:[0-9a-f]{6,}|[a-z0-9]{9,})($|[-_])|^(?:css|sc|jss|emotion|mui|ng|_ngcontent|ember)[-_]/i;

// Utility-first frameworks (Tailwind and friends) put styling in the class
// list: `flex`, `mt-5`, `md:grid`, `[&>*+*]:mt-5`. They say nothing about which
// element this is, appear on hundreds of others, and churn with every redesign.
const UTILITY_CLASS =
  /[:[\]]|^(?:flex|grid|block|contents|container|hidden|visible|relative|absolute|fixed|sticky|static|truncate|grow|shrink|transform|transition|antialiased|italic|underline|uppercase|lowercase|capitalize|resize|group|peer|rounded|border|shadow|ring|outline|prose|isolate|filter|blur)$|^(?:flex|inline|items|justify|self|content|place|gap|space|order|basis|col|row|[mp][trblxy]?|w|h|min|max|text|font|leading|tracking|indent|align|whitespace|break|list|bg|from|via|to|border|rounded|divide|ring|outline|shadow|opacity|mix|blur|backdrop|filter|z|overflow|overscroll|object|aspect|cursor|pointer|select|scroll|snap|touch|will|duration|delay|ease|animate|scale|rotate|translate|skew|origin|placeholder|caret|accent|decoration|underline|sr|not)-/i;

// Classes that describe the moment rather than the element: present while
// hovered/open/selected and gone a second later.
const STATE_CLASS =
  /^(?:is-|has-)?(?:active|selected|open|closed|focus(?:ed)?|hover|disabled|checked|expanded|collapsed|show|shown|hidden|visible|current|loading|dragging|sticky|pressed)$/i;

// `page-has-toc`, `is-scrolled`, `no-sidebar`, `layout-default` — these track
// what the page happens to look like right now, so a selector built on them
// breaks on the next page of the same site.
const VARIANT_CLASS = /^(?:is|has|no|js|layout|theme|mode|variant|state)-|-(?:has|is)-/i;

// `@container`, `md:flex`, `[&>*+*]:mt-5`, `2xl:p-4` — anything that has to be
// escaped to appear in a selector came from a framework, not from someone
// naming this element.
function needsEscaping(token: string): boolean {
  try {
    return CSS.escape(token) !== token;
  } catch {
    return true;
  }
}

function isStableToken(token: string): boolean {
  return (
    token.length >= 2 &&
    token.length <= 40 &&
    !needsEscaping(token) &&
    !GENERATED_TOKEN.test(token) &&
    !/^\d+$/.test(token)
  );
}

// The two-character floor above is aimed at minified class noise; an id may
// legitimately be a single letter and is still far better than a position.
function isStableId(id: string): boolean {
  return id.length >= 1 && id.length <= 40 && !GENERATED_TOKEN.test(id) && !/^\d+$/.test(id);
}

// Playwright's own syntax for "the Nth element matching this selector". CSS has
// no way to say it, and it is the only way to address one of many identical
// blocks without a brittle positional path. Playwright understands it natively;
// resolveOne teaches the in-browser replay the same trick.
const NTH_MATCH = /^:nth-match\((.+),\s*(\d+)\)$/;

export function resolveOne(doc: Document, selector: string): Element | null {
  const nth = NTH_MATCH.exec(selector);
  if (nth) return doc.querySelectorAll(nth[1])[Number(nth[2]) - 1] ?? null;
  return doc.querySelector(selector);
}

function matchesOnly(selector: string, el: Element): boolean {
  try {
    if (NTH_MATCH.test(selector)) return resolveOne(el.ownerDocument, selector) === el;
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

// A class shared by many elements describes how something looks, not which one
// it is. Counting beats maintaining a list of every framework's vocabulary.
const SHARED_CLASS_LIMIT = 4;

function isIdentifyingClass(el: Element, className: string): boolean {
  if (!isStableToken(className) || STATE_CLASS.test(className) || UTILITY_CLASS.test(className)) return false;
  if (VARIANT_CLASS.test(className)) return false;
  return el.ownerDocument.getElementsByClassName(className).length <= SHARED_CLASS_LIMIT;
}

function stableClassSelector(el: Element): string | null {
  const classes = Array.from(el.classList).filter((c) => isIdentifyingClass(el, c));
  if (classes.length === 0) return null;
  return `${el.tagName.toLowerCase()}${classes.map((c) => `.${CSS.escape(c)}`).join('')}`;
}

// Landmarks are part of the page's structure rather than its styling, so they
// outlast redesigns that shuffle the wrapper divs around them.
const LANDMARK_TAGS = ['MAIN', 'ARTICLE', 'NAV', 'HEADER', 'FOOTER', 'ASIDE', 'FORM', 'TABLE'];

function landmarkSelector(el: Element): string | null {
  if (!LANDMARK_TAGS.includes(el.tagName)) return null;
  const tag = el.tagName.toLowerCase();
  return matchesOnly(tag, el) ? tag : null;
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
  if (el.id && isStableId(el.id) && matchesOnly(`#${CSS.escape(el.id)}`, el)) return `#${CSS.escape(el.id)}`;

  for (const attribute of TEST_ATTRIBUTES) {
    const candidate = attributeSelector(el, attribute);
    if (candidate && matchesOnly(candidate, el)) return candidate;
  }

  // before the class list: a landmark is structural, its classes are cosmetic
  const landmark = landmarkSelector(el);
  if (landmark) return landmark;

  const byClass = stableClassSelector(el);
  if (byClass && matchesOnly(byClass, el)) return byClass;

  const byRole = attributeSelector(el, 'role');
  return byRole && matchesOnly(byRole, el) ? byRole : null;
}

function absolutePath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;

  while (current && current.tagName !== 'BODY' && current.tagName !== 'HTML') {
    parts.unshift(nthOfType(current));
    current = current.parentElement;
  }

  return `body > ${parts.join(' > ')}`;
}

// "main pre" instead of "main > div > div:nth-of-type(2) > div > pre": the
// wrapper divs a layout adds or removes are exactly what breaks a child chain,
// and a descendant selector simply does not care about them.
function looseDescendantPath(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  let current: Element | null = el.parentElement;

  for (let depth = 0; current && depth < MAX_PATH_DEPTH; depth++) {
    const anchor = anchorSelector(current);
    if (anchor) {
      const candidate = `${anchor} ${tag}`;
      if (matchesOnly(candidate, el)) return candidate;
    }
    current = current.parentElement;
  }

  return null;
}

// When several elements share the best available selector — one code block of
// many — pin the right one by index instead of falling back to a positional
// path that breaks as soon as a wrapper div appears.
function nthMatchSelector(el: Element): string | null {
  const tag = el.tagName.toLowerCase();

  let scope: string | null = null;
  let current: Element | null = el.parentElement;
  for (let depth = 0; current && depth < MAX_PATH_DEPTH; depth++) {
    scope = anchorSelector(current);
    if (scope) break;
    current = current.parentElement;
  }

  const base = scope ? `${scope} ${tag}` : tag;
  const matches = Array.from(el.ownerDocument.querySelectorAll(base));
  const index = matches.indexOf(el);
  return index === -1 ? null : `:nth-match(${base}, ${index + 1})`;
}

// Same order as generateSelectorCandidates up through looseDescendantPath/bare
// tag, but stops at the first match instead of computing every remaining
// strategy — callers that only need a yes/no (is this element identifiable by
// something other than its position) don't need the nth-match/anchored/
// absolute tail, which is the expensive part on pages with many elements.
export function hasNonPositionalSelector(el: Element): boolean {
  if (el.id && isStableId(el.id) && matchesOnly(`#${CSS.escape(el.id)}`, el)) return true;
  for (const attribute of TEST_ATTRIBUTES) {
    const candidate = attributeSelector(el, attribute);
    if (candidate && matchesOnly(candidate, el)) return true;
  }
  for (const attribute of ['name', 'aria-label', 'placeholder', 'title', 'alt']) {
    const candidate = attributeSelector(el, attribute);
    if (candidate && matchesOnly(candidate, el)) return true;
  }
  if (el.tagName === 'A') {
    const href = attributeSelector(el, 'href');
    if (href && matchesOnly(href, el)) return true;
  }
  const byClass = stableClassSelector(el);
  if (byClass && matchesOnly(byClass, el)) return true;
  if (looseDescendantPath(el) !== null) return true;
  return matchesOnly(el.tagName.toLowerCase(), el);
}

// Ordered best-first, every one verified to match this element and nothing else.
export function generateSelectorCandidates(el: Element): string[] {
  const candidates: string[] = [];
  const add = (selector: string | null) => {
    if (selector && !candidates.includes(selector) && matchesOnly(selector, el)) candidates.push(selector);
  };

  if (el.id && isStableId(el.id)) add(`#${CSS.escape(el.id)}`);
  for (const attribute of TEST_ATTRIBUTES) add(attributeSelector(el, attribute));

  add(attributeSelector(el, 'name'));
  add(attributeSelector(el, 'aria-label'));
  add(attributeSelector(el, 'placeholder'));
  add(attributeSelector(el, 'title'));
  add(attributeSelector(el, 'alt'));
  if (el.tagName === 'A') add(attributeSelector(el, 'href'));
  add(stableClassSelector(el));
  add(looseDescendantPath(el));
  add(el.tagName.toLowerCase()); // rare, but "the only <pre> on the page" is solid
  add(nthMatchSelector(el));
  add(anchoredPath(el));
  add(absolutePath(el));

  // nothing matched uniquely (duplicate ids, repeated markup): the raw path at
  // least resolves today, and having it beats having no step at all
  if (candidates.length === 0) candidates.push(absolutePath(el));

  return candidates;
}

export function generateSelector(el: Element): string {
  return generateSelectorCandidates(el)[0];
}
