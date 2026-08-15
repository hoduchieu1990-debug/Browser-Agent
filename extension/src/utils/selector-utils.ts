export function generateSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;

  const testId = el.getAttribute('data-testid');
  if (testId) return `[data-testid="${testId}"]`;

  const name = el.getAttribute('name');
  if (name) return `${el.tagName.toLowerCase()}[name="${name}"]`;

  return buildPathSelector(el);
}

function buildPathSelector(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;
  let depth = 0;

  while (current && current.tagName !== 'BODY' && depth < 5) {
    const parent: Element | null = current.parentElement;
    const tag = current.tagName.toLowerCase();

    if (parent) {
      const siblings = Array.from(parent.children).filter((c) => c.tagName === current!.tagName);
      const index = siblings.indexOf(current) + 1;
      parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
    } else {
      parts.unshift(tag);
    }

    current = parent;
    depth++;
  }

  return parts.join(' > ');
}
