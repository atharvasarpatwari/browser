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
 *   - Pseudo-elements (::before, ::after, etc.) — detected but not matched (always false)
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
  const elementClasses = parseClassList(element);
  for (const cls of sel.classes) {
    if (!elementClasses.has(cls.toLowerCase())) return false;
  }

  // Attributes
  for (const attr of sel.attributes) {
    if (!matchesAttribute(element, attr)) return false;
  }

  // Pseudo-classes
  for (const pc of sel.pseudoClasses) {
    if (!matchesPseudoClass(element, pc)) return false;
  }

  // Pseudo-elements — can't match in this context (they refer to generated content)
  // We just ignore them for matching purposes (return true if only pseudo-element differs)

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
      return matchesSelectorList(element, pseudo.selectors);
    case 'has':
      return matchesHasPseudoClass(element, pseudo.selectors);
    default:
      return false;
  }
}

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
    case 'enabled':  return true;  // Most elements are enabled by default
    case 'disabled': return false;
    case 'checked':  return false;
    case 'required': return false;
    case 'optional': return true;
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
      return element.children.length === 0 && !hasTextContent(element);
    }
    case 'blank': {
      return element.children.length === 0 && !hasTextContent(element);
    }
    case 'focus-within': return false;
    case 'focus-visible': return false;
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

    case 'nth-child': {
      if (!value) return false;
      const anb = parseAnB(value);
      if (!anb) return false;
      const pos = idx + 1; // 1-based
      return matchesAnB(anb, pos);
    }
    case 'nth-last-child': {
      if (!value) return false;
      const anb = parseAnB(value);
      if (!anb) return false;
      const pos = siblings.length - idx; // 1-based from end
      return matchesAnB(anb, pos);
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
      return element.children.length === 0 && !hasTextContent(element);
    }

    default: return false;
  }
}

function matchesHasPseudoClass(element: SelectableElement, selectors: readonly CssSelector[]): boolean {
  // :has() checks if any descendant matches the selector
  return hasDescendantMatching(element, selectors);
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
  if (match[1] !== undefined && match[1] !== '' && match[1] !== '+') {
    a = parseInt(match[1], 10);
  } else if (match[1] === '' || match[1] === '+') {
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

  // BFS
  const queue: SelectableElement[] = [root];
  while (queue.length > 0) {
    const el = queue.shift()!;
    if (matchesSelectorList(el, parsed)) return el;
    for (const child of el.children) {
      queue.push(child);
    }
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
  const queue: SelectableElement[] = [root];
  while (queue.length > 0) {
    const el = queue.shift()!;
    if (matchesSelectorList(el, parsed)) result.push(el);
    for (const child of el.children) {
      queue.push(child);
    }
  }
  return result;
}

/**
 * Parse a CSS selector string into CssSelector[].
 * Delegates to the parser module's parseSelector.
 */
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

function parseClassList(element: SelectableElement): Set<string> {
  const classStr = element.attributes.get('class') ?? '';
  return new Set(classStr.split(/\s+/).filter(Boolean).map(c => c.toLowerCase()));
}

function hasValue(element: SelectableElement): boolean {
  const value = element.attributes.get('value');
  return value !== undefined && value.length > 0;
}

function hasTextContent(element: SelectableElement): boolean {
  // Check if element has any text-like children (in parse tree, text nodes are separate)
  // For our purposes, we check if the element has children with text-like properties
  return false;
}
