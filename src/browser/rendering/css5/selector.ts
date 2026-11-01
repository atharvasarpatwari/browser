/**
 * @file css5/selector.ts
 * CSS Selector matching engine.
 *
 * Matches CSS selectors against DOM elements. Works with any element type
 * that satisfies the SelectableElement interface.
 *
 * Supports:
 *   - Universal selector (*)
 *   - Type selectors (div, span, etc.)
 *   - ID selectors (#id)
 *   - Class selectors (.class)
 *   - Attribute selectors ([attr], [attr=val], [attr~=val], [attr|=val], [attr^=val], [attr$=val], [attr*=val])
 *   - Pseudo-classes (:hover, :focus, :active, :visited, :first-child, :last-child, :nth-child(), etc.)
 *   - Pseudo-elements (::before, ::after, etc.) — detected; never match the element itself
 *   - Combinators: descendant ( ), child (>), adjacent sibling (+), general sibling (~)
 *   - :not(), :is(), :has() functional pseudo-classes
 *   - Selector lists (comma-separated)
 */

import type { CssSelector, CssCompoundSelector, CssComplexSelector, CssCombinator, CssAttributeSelector, CssPseudoClassSelector } from './types';
import { CssParser } from './parser';

// ─────────────────────────────────────────────────────────────────────────────
// INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

export interface SelectableElement {
  readonly tagName: string;
  readonly attributes: ReadonlyMap<string, string>;
  readonly parent: SelectableElement | null;
  readonly children: readonly SelectableElement[];
  /** Has a text child (children lists only elements): `:empty` needs it. */
  readonly hasText?: boolean;
  /** A checkbox/radio's live checked state (a tap changes it, not the attribute). */
  readonly checked?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// MATCHING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if an element matches a CSS selector.
 */
export function matchesSelector(element: SelectableElement, selector: CssSelector): boolean {
  if (selector.type === 'compound') {
    return matchesCompound(element, selector);
  }
  return matchesComplex(element, selector);
}

/**
 * Check if an element matches any selector in a selector list.
 */
export function matchesSelectorList(element: SelectableElement, selectors: readonly CssSelector[]): boolean {
  for (const sel of selectors) {
    if (matchesSelector(element, sel)) return true;
  }
  return false;
}

/** The rightmost compound's pseudo-element (`li::before` → 'before'), or null. */
export function selectorPseudoElement(selector: CssSelector): string | null {
  const right = selector.type === 'compound' ? selector : selector.right;
  return (right as { pseudoElement?: string | null }).pseudoElement ?? null;
}

/** Does any selector style `element`'s `pseudo` (e.g. 'before') box? */
export function matchesSelectorListForPseudo(element: SelectableElement, selectors: readonly CssSelector[], pseudo: string): boolean {
  for (const sel of selectors) {
    if (selectorPseudoElement(sel) !== pseudo) continue;
    if (sel.type === 'compound') {
      if (matchesCompound(element, { ...sel, pseudoElement: null })) return true;
    } else if (matchesComplex(element, { ...sel, right: { ...sel.right, pseudoElement: null } })) {
      return true;
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOUND SELECTOR MATCHING
// ─────────────────────────────────────────────────────────────────────────────

function matchesCompound(element: SelectableElement, sel: CssCompoundSelector): boolean {
  // Tag name
  if (sel.tagName !== null && sel.tagName !== '*') {
    if (element.tagName.toLowerCase() !== sel.tagName.toLowerCase()) return false;
  }

  // ID
  if (sel.id !== null) {
    if ((element.attributes.get('id') ?? '') !== sel.id) return false;
  }

  // Classes
  if (sel.classes.length > 0) {
    const elementClasses = parseClassList(element);
    for (const cls of sel.classes) {
      if (!elementClasses.has(cls.toLowerCase())) return false;
    }
  }

  // Attributes
  for (const attr of sel.attributes) {
    if (!matchesAttribute(element, attr)) return false;
  }

  // Pseudo-classes
  for (const pc of sel.pseudoClasses) {
    if (!matchesPseudoClass(element, pc)) return false;
  }

  // Pseudo-elements (::before, ::after, ::placeholder…) style generated boxes, never the element.
  // They were ignored here, so `.hero::before { position: absolute; inset: 0 }` made the hero
  // itself absolutely positioned (httpforever.com lost its header). Generated content isn't
  // rendered yet, so these rules simply don't apply.
  if ((sel as { pseudoElement?: string | null }).pseudoElement) return false;

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPLEX SELECTOR MATCHING
// ─────────────────────────────────────────────────────────────────────────────

function matchesComplex(element: SelectableElement, sel: CssComplexSelector): boolean {
  // Match the right side first
  if (!matchesCompound(element, sel.right)) return false;

  // Then check the combinator relationship
  switch (sel.combinator) {
    case ' ':  return matchesDescendant(element, sel.left);
    case '>':  return matchesChild(element, sel.left);
    case '+':  return matchesAdjacentSibling(element, sel.left);
    case '~':  return matchesGeneralSibling(element, sel.left);
    default:   return false;
  }
}

function matchesDescendant(element: SelectableElement, left: CssSelector): boolean {
  let current: SelectableElement | null = element.parent;
  while (current) {
    if (matchesSelector(current, left)) return true;
    current = current.parent;
  }
  return false;
}

function matchesChild(element: SelectableElement, left: CssSelector): boolean {
  if (!element.parent) return false;
  return matchesSelector(element.parent, left);
}

function matchesAdjacentSibling(element: SelectableElement, left: CssSelector): boolean {
  if (!element.parent) return false;
  const siblings = element.parent.children;
  const idx = siblings.indexOf(element);
  if (idx <= 0) return false;
  return matchesSelector(siblings[idx - 1]!, left);
}

function matchesGeneralSibling(element: SelectableElement, left: CssSelector): boolean {
  if (!element.parent) return false;
  const siblings = element.parent.children;
  const idx = siblings.indexOf(element);
  for (let i = 0; i < idx; i++) {
    if (matchesSelector(siblings[i]!, left)) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// ATTRIBUTE MATCHING
// ─────────────────────────────────────────────────────────────────────────────

function matchesAttribute(element: SelectableElement, attr: CssAttributeSelector): boolean {
  const elementValue = element.attributes.get(attr.name);

  if (attr.operator === null) {
    // [attr] — just check existence
    return elementValue !== undefined;
  }

  if (elementValue === undefined) return false;

  const ev = attr.caseInsensitive ? elementValue.toLowerCase() : elementValue;
  const sv = attr.value !== null ? (attr.caseInsensitive ? attr.value.toLowerCase() : attr.value) : '';

  switch (attr.operator) {
    case '=':   return ev === sv;
    case '~=':  return ev.split(/\s+/).includes(sv);
    case '|=':  return ev === sv || ev.startsWith(sv + '-');
    case '^=':  return ev.startsWith(sv);
    case '$=':  return ev.endsWith(sv);
    case '*=':  return ev.includes(sv);
    default:    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PSEUDO-CLASS MATCHING
// ─────────────────────────────────────────────────────────────────────────────

function matchesPseudoClass(element: SelectableElement, pseudo: CssPseudoClassSelector): boolean {
  switch (pseudo.type) {
    case 'dynamic':
      return matchesDynamicPseudoClass(element, pseudo.name);
    case 'structural':
      return matchesStructuralPseudoClass(element, pseudo.name, pseudo.value);
    case 'negation':
      return !matchesSelectorList(element, pseudo.selectors);
    case 'is':
    case 'any':
    case 'where':
      return matchesSelectorList(element, pseudo.selectors);
    case 'has':
      return matchesHasPseudoClass(element, pseudo.selectors, pseudo.relative);
    default:
      return false;
  }
}

const FORM_CONTROLS = new Set(['button', 'input', 'select', 'textarea', 'optgroup', 'option', 'fieldset']);
const isFormControl = (el: SelectableElement): boolean => FORM_CONTROLS.has(el.tagName.toLowerCase());

/** HTML §4.16.3 disabled: its own attribute, or inside a disabled fieldset. */
function isDisabled(el: SelectableElement): boolean {
  if (!isFormControl(el)) return false;
  if (el.attributes.has('disabled')) return true;
  for (let p = el.parent; p; p = p.parent) {
    if (p.tagName.toLowerCase() === 'fieldset' && p.attributes.has('disabled')) return true;
  }
  return false;
}

function isChecked(el: SelectableElement): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === 'option') return el.attributes.has('selected');
  if (tag !== 'input') return false;
  const type = (el.attributes.get('type') ?? '').toLowerCase();
  if (type !== 'checkbox' && type !== 'radio') return false;
  return el.checked ?? el.attributes.has('checked');
}

const isFormField = (el: SelectableElement): boolean => ['input', 'select', 'textarea'].includes(el.tagName.toLowerCase());

function matchesDynamicPseudoClass(element: SelectableElement, name: string): boolean {
  // In a server-side/headless context, these states don't apply.
  // We return false for interactive states.
  switch (name) {
    case 'hover':    return false;
    case 'focus':    return false;
    case 'active':   return false;
    case 'visited':  return false;
    case 'link':     return true;  // :link matches unvisited links
    case 'any-link': return true;  // :any-link matches links
    // Form states from the element (they were constant: nothing was ever :disabled, :checked or
    // :required, so `input:checked + label` toggles and disabled-button styles never applied).
    case 'enabled':  return isFormControl(element) && !isDisabled(element);
    case 'disabled': return isDisabled(element);
    case 'checked':  return isChecked(element);
    case 'required': return isFormField(element) && element.attributes.has('required');
    case 'optional': return isFormField(element) && !element.attributes.has('required');
    case 'read-only': {
      const readOnly = element.attributes.get('contenteditable');
      return readOnly === 'false' || readOnly === undefined;
    }
    case 'read-write': {
      const rw = element.attributes.get('contenteditable');
      return rw === 'true';
    }
    case 'placeholder-shown': {
      return element.attributes.has('placeholder') && !hasValue(element);
    }
    case 'default':    return false;
    case 'valid':      return true;  // Assume valid
    case 'invalid':    return false;
    case 'in-range':   return false;
    case 'out-of-range': return false;
    case 'indeterminate': return false;
    case 'root': {
      return element.tagName.toLowerCase() === 'html' || element.parent === null;
    }
    case 'scope': {
      return element.parent === null;
    }
    case 'empty': {
      return element.children.length === 0 && !element.hasText;
    }
    case 'blank': {
      return element.children.length === 0 && !element.hasText;
    }
    case 'focus-within': return false;
    case 'focus-visible': return false;
    // The parser files these argument-less structural ones as dynamic.
    case 'only-child':
    case 'only-of-type':
    case 'first-child':
    case 'last-child':
    case 'first-of-type':
    case 'last-of-type':
      return matchesStructuralPseudoClass(element, name, null);
    default: return false;
  }
}

function matchesStructuralPseudoClass(element: SelectableElement, name: string, value: string | null): boolean {
  const siblings = element.parent ? element.parent.children : [];
  const sameTypeSiblings = element.parent
    ? siblings.filter(s => s.tagName.toLowerCase() === element.tagName.toLowerCase())
    : [];
  const idx = siblings.indexOf(element);
  const typeIdx = sameTypeSiblings.indexOf(element);

  switch (name) {
    case 'first-child':  return idx === 0;
    case 'last-child':   return idx === siblings.length - 1;
    case 'first-of-type': return typeIdx === 0;
    case 'last-of-type':  return typeIdx === sameTypeSiblings.length - 1;
    case 'only-child':    return siblings.length === 1 || !element.parent;
    case 'only-of-type':  return sameTypeSiblings.length === 1 || !element.parent;

    case 'nth-child':
    case 'nth-last-child': {
      if (!value) return false;
      // `An+B of S` (Selectors 4 §14.4) counts only the siblings matching S.
      const of = /^(.*?)\s+of\s+(.+)$/i.exec(value.trim());
      const anb = parseAnB(of ? of[1]! : value);
      if (!anb) return false;
      let pool = siblings;
      if (of) {
        const filter = parseSelectorListCached(of[2]!);
        if (!filter || !matchesSelectorList(element, filter)) return false;
        pool = siblings.filter((s) => matchesSelectorList(s, filter));
      }
      const at = pool.indexOf(element);
      return matchesAnB(anb, name === 'nth-child' ? at + 1 : pool.length - at);
    }
    case 'lang': {
      // :lang(fr) matches the nearest lang attribute "fr" or "fr-…" (case-insensitive).
      if (!value) return false;
      let lang: string | undefined;
      for (let n: SelectableElement | null = element; n && lang === undefined; n = n.parent) lang = n.attributes.get('lang');
      const want = value.trim().replace(/^["']|["']$/g, '').toLowerCase();
      const have = (lang ?? '').toLowerCase();
      return have === want || have.startsWith(want + '-');
    }
    case 'nth-of-type': {
      if (!value) return false;
      const anb = parseAnB(value);
      if (!anb) return false;
      const pos = typeIdx + 1; // 1-based
      return matchesAnB(anb, pos);
    }
    case 'nth-last-of-type': {
      if (!value) return false;
      const anb = parseAnB(value);
      if (!anb) return false;
      const pos = sameTypeSiblings.length - typeIdx;
      return matchesAnB(anb, pos);
    }

    case 'not': {
      // Handled above in matchesPseudoClass
      return true;
    }
    case 'is':
    case 'any':
    case 'where':
    case 'matches': {
      return true;
    }
    case 'has': {
      return true;
    }

    case 'empty': {
      return element.children.length === 0 && !element.hasText;
    }

    default: return false;
  }
}

function matchesHasPseudoClass(element: SelectableElement, selectors: readonly CssSelector[], relative?: readonly CssCombinator[]): boolean {
  // Each relative selector is anchored by its combinator: `> x` a child, `+ x` the next sibling,
  // `~ x` a later sibling, else any descendant.
  const siblings = element.parent ? element.parent.children : [];
  const idx = siblings.indexOf(element);
  return selectors.some((sel, i) => {
    switch (relative?.[i] ?? ' ') {
      case '>': return element.children.some((c) => matchesSelector(c, sel));
      case '+': return idx >= 0 && idx + 1 < siblings.length && matchesSelector(siblings[idx + 1]!, sel);
      case '~': return idx >= 0 && siblings.slice(idx + 1).some((s) => matchesSelector(s, sel));
      default:  return hasDescendantMatching(element, [sel]);
    }
  });
}

function hasDescendantMatching(element: SelectableElement, selectors: readonly CssSelector[]): boolean {
  for (const child of element.children) {
    if (matchesSelectorList(child, selectors)) return true;
    if (hasDescendantMatching(child, selectors)) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// AN+B PARSING (for :nth-child etc.)
// ─────────────────────────────────────────────────────────────────────────────

interface AnB {
  a: number;
  b: number;
}

function parseAnB(value: string): AnB | null {
  const trimmed = value.trim().toLowerCase();

  if (trimmed === 'odd') return { a: 2, b: 1 };
  if (trimmed === 'even') return { a: 2, b: 0 };

  // Match patterns like "2n+1", "2n-1", "-2n+3", "n+5", "-n+3", "5"
  const match = trimmed.match(/^([+-]?\d*)?n\s*([+-]\s*\d+)?$/);
  if (!match) {
    // Pure number
    const num = parseInt(trimmed, 10);
    if (!isNaN(num)) return { a: 0, b: num };
    return null;
  }

  let a = 0;
  if (match[1] === '-') {
    a = -1; // -n+3: parseInt('-') was NaN, so :nth-child(-n+3) ("the first three") never matched
  } else if (match[1] !== undefined && match[1] !== '' && match[1] !== '+') {
    a = parseInt(match[1], 10);
  } else if (match[1] === '' || match[1] === '+' || match[1] === undefined) {
    a = 1;
  }

  let b = 0;
  if (match[2]) {
    b = parseInt(match[2].replace(/\s/g, ''), 10);
  }

  return { a, b };
}

function matchesAnB(anb: AnB, pos: number): boolean {
  if (anb.a === 0) return pos === anb.b;
  const n = (pos - anb.b) / anb.a;
  return Number.isInteger(n) && n >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// QUERY SELECTORS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find the first element in a tree that matches a selector string.
 */
export function querySelector(root: SelectableElement, selector: string): SelectableElement | null {
  const parsed = parseSelectorString(selector);
  if (!parsed) return null;

  // Document order (pre-order depth-first). This was breadth-first, so the shallowest match won:
  // on Wikipedia `querySelector('section')` returned a footer section, not the article's.
  const stack: SelectableElement[] = [root];
  while (stack.length > 0) {
    const el = stack.pop()!;
    if (matchesSelectorList(el, parsed)) return el;
    for (let i = el.children.length - 1; i >= 0; i--) stack.push(el.children[i]!);
  }
  return null;
}

/**
 * Find all elements in a tree that match a selector string.
 */
export function querySelectorAll(root: SelectableElement, selector: string): SelectableElement[] {
  const parsed = parseSelectorString(selector);
  if (!parsed) return [];

  const result: SelectableElement[] = [];
  const stack: SelectableElement[] = [root]; // document order, as querySelector
  while (stack.length > 0) {
    const el = stack.pop()!;
    if (matchesSelectorList(el, parsed)) result.push(el);
    for (let i = el.children.length - 1; i >= 0; i--) stack.push(el.children[i]!);
  }
  return result;
}

/**
 * Parse a CSS selector string into CssSelector[].
 * Delegates to the parser module's parseSelector.
 */
const selectorListCache = new Map<string, CssSelector[] | null>();

/** A selector list from pseudo-class arguments (`nth-child(2 of .x, .y)`), parsed once. */
function parseSelectorListCached(text: string): CssSelector[] | null {
  if (!selectorListCache.has(text)) {
    const parser = new CssParser();
    const list = text.split(',').map((s) => parser.parseSelector(s.trim())).filter((s): s is CssSelector => !!s);
    selectorListCache.set(text, list.length > 0 ? list : null);
  }
  return selectorListCache.get(text)!;
}

function parseSelectorString(str: string): CssSelector[] | null {
  try {
    const parser = new CssParser();
    const selector = parser.parseSelector(str);
    return selector ? [selector] : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

// Parsed class lists by attribute value: the same few strings are matched against thousands of
// selectors, and re-splitting them each time was a top cost of styling large pages.
const classListCache = new Map<string, Set<string>>();

function parseClassList(element: SelectableElement): Set<string> {
  const classStr = element.attributes.get('class') ?? '';
  let set = classListCache.get(classStr);
  if (!set) {
    if (classListCache.size > 4096) classListCache.clear(); // ponytail: crude bound, fine for one page's distinct class strings
    set = new Set(classStr.split(/\s+/).filter(Boolean).map(c => c.toLowerCase()));
    classListCache.set(classStr, set);
  }
  return set;
}

function hasValue(element: SelectableElement): boolean {
  const value = element.attributes.get('value');
  return value !== undefined && value.length > 0;
}


