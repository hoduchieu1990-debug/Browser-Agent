import type { ActionFramework } from '../types';

// Nexacro and WebSquare (both common in Korean enterprise systems) render
// their own widget trees instead of plain HTML controls, which is worth
// knowing when reading a recording back later — a step whose selector points
// at a nondescript <div> makes more sense once you know a framework drew it.
//
// Heuristics, deliberately: neither framework exposes a version-stable "what
// am I" API, so this goes by the markup each one leaves behind. The tag is
// metadata only (never read during replay), so a false positive mislabels a
// step and changes nothing else.
//
// data-ba-nexacro-id is the surest signal of all: nexacro-bridge.ts only
// stamps it after resolving the element against the live component tree, and
// it is already being stamped whenever this runs, since both only happen
// while recording. (window.nexacro itself is no use here — a content
// script's isolated world shares the DOM but not the page's globals, which
// is why that bridge exists at all.)
//
// A Nexacro-rendered id is a dotted object-model path, often with a
// rendering suffix ("…TextField00.box:simpleinput"). That colon is a decent
// hint about the element under the cursor but a poor one about a whole page
// — JSF generates "form:field" ids too — so the wider fallback below uses
// only the markers no other framework produces.
const NEXACRO_ELEMENT = "[data-ba-nexacro-id], .nexacontainer, .nexacomp, [id*='nexacro'], [id*=':']";
const NEXACRO_PAGE = '[data-ba-nexacro-id], .nexacontainer, .nexacomp';
const WEBSQUARE_ELEMENT = "[class*='w2'], [id*='w2'], .w2textbox, .w2grid";
const WEBSQUARE_PAGE = '.w2textbox, .w2grid';

export function detectFramework(el: Element): ActionFramework | undefined {
  if (el.closest(NEXACRO_ELEMENT)) return 'nexacro';
  if (el.closest(WEBSQUARE_ELEMENT)) return 'websquare';

  // The element itself may be plain even on a framework page (a wrapper the
  // framework didn't draw), so fall back to what the document as a whole is.
  const doc = el.ownerDocument ?? document;
  if (doc.querySelector(NEXACRO_PAGE)) return 'nexacro';
  if (doc.querySelector(WEBSQUARE_PAGE)) return 'websquare';
  return undefined;
}
