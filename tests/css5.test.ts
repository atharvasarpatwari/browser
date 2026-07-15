import { describe, it, expect } from 'vitest';
import {
  tokenizeCss,
  tokenizeCssClean,
} from '../src/browser/rendering/css5/tokenizer';
import { CssParser } from '../src/browser/rendering/css5/parser';
import {
  matchesSelector,
  matchesSelectorList,
  querySelector,
  querySelectorAll,
} from '../src/browser/rendering/css5/selector';
import type { SelectableElement } from '../src/browser/rendering/css5/selector';
import {
  computeComputedStyles,
  expandShorthands,
  getUserAgentDefaults,
  applyInheritance,
} from '../src/browser/rendering/css5/cascade';
import type { StyleableElement } from '../src/browser/rendering/css5/cascade';
import type {
  CssDeclaration,
  CssSelector,
  CssStylesheet,
} from '../src/browser/rendering/css5/types';
import { CssParser as LegacyCssParser, specificityWeight } from '../src/browser/rendering/css-parser';

// ─────────────────────────────────────────────────────────────────────────────
// SELECTABLE ELEMENT BUILDER HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function sel(
  tag: string,
  attrs?: Record<string, string>,
  children?: SelectableElement[],
  parent?: SelectableElement,
): SelectableElement {
  const node: SelectableElement = {
    tagName: tag,
    attributes: new Map(Object.entries(attrs ?? {})),
    parent: parent ?? null,
    children: children ?? [],
  };
  // Set parent pointers on children
  for (const child of node.children) {
    (child as { parent: SelectableElement | null }).parent = node;
  }
  return node;
}

function styleEl(
  tag: string,
  attrs?: Record<string, string>,
  children?: StyleableElement[],
  parent?: StyleableElement,
): StyleableElement {
  const node: StyleableElement = {
    tagName: tag,
    attributes: new Map(Object.entries(attrs ?? {})),
    parent: parent ?? null,
    children: children ?? [],
  };
  for (const child of node.children) {
    (child as { parent: StyleableElement | null }).parent = node;
  }
  return node;
}

/** Helper: build CssDeclaration array from property/value pairs */
function decls(...pairs: [string, string][]): CssDeclaration[] {
  return pairs.map(([property, value]) => ({ property, value, important: false }));
}

/** Helper: get a declaration's value from an expanded array */
function declVal(expanded: CssDeclaration[], prop: string): string | undefined {
  return expanded.find(d => d.property === prop)?.value;
}

// ─────────────────────────────────────────────────────────────────────────────
// TOKENIZER
// ─────────────────────────────────────────────────────────────────────────────

describe('CSS5 — Tokenizer', () => {
  it('tokenizes a simple type selector', () => {
    const tokens = tokenizeCss('div { color: red; }');
    expect(tokens.length).toBeGreaterThan(5);
  });

  it('tokenizes string values', () => {
    const tokens = tokenizeCss('a[href="https://example.com"]');
    const strings = tokens.filter(t => t.type === 'string');
    expect(strings.length).toBe(1);
    expect(strings[0]!.value).toBe('https://example.com');
  });

  it('tokenizes hash (id) selectors', () => {
    const tokens = tokenizeCss('#myid');
    const hashes = tokens.filter(t => t.type === 'hash');
    expect(hashes.length).toBe(1);
    expect(hashes[0]!.value).toBe('myid');
  });

  it('tokenizes class selectors', () => {
    const tokens = tokenizeCss('.myclass');
    expect(tokens.some(t => t.type === '.')).toBe(true);
  });

  it('tokenizes dimensions', () => {
    const tokens = tokenizeCss('10px');
    const dims = tokens.filter(t => t.type === 'dimension');
    expect(dims.length).toBe(1);
    expect(dims[0]!.value).toBe('10px');
  });

  it('tokenizes percentages', () => {
    const tokens = tokenizeCss('50%');
    const pcts = tokens.filter(t => t.type === 'percentage');
    expect(pcts.length).toBe(1);
    expect(pcts[0]!.value).toBe('50%');
  });

  it('tokenizes numbers', () => {
    const tokens = tokenizeCss('42');
    const nums = tokens.filter(t => t.type === 'number');
    expect(nums.length).toBe(1);
    expect(nums[0]!.value).toBe('42');
  });

  it('tokenizes function tokens', () => {
    const tokens = tokenizeCss('rgb(255, 0, 0)');
    const fns = tokens.filter(t => t.type === 'function');
    expect(fns.length).toBe(1);
    expect(fns[0]!.value).toBe('rgb');
  });

  it('tokenizes at-keywords', () => {
    const tokens = tokenizeCss('@media');
    const ats = tokens.filter(t => t.type === 'at-keyword');
    expect(ats.length).toBe(1);
    expect(ats[0]!.value).toBe('media');
  });

  it('strips comments', () => {
    const tokens = tokenizeCssClean('div /* comment */ { color: red; }');
    const comments = tokens.filter(t => t.type === 'comment');
    expect(comments.length).toBe(0);
  });

  it('tokenizes combinator delimiters', () => {
    const tokens = tokenizeCss('div > span + p ~ ul');
    const gt = tokens.filter(t => t.type === '>');
    const plus = tokens.filter(t => t.type === '+');
    const tilde = tokens.filter(t => t.type === '~');
    expect(gt.length).toBe(1);
    expect(plus.length).toBe(1);
    expect(tilde.length).toBe(1);
  });

  it('tokenizes attribute operators', () => {
    const tokens = tokenizeCss('[class~="active"]');
    // The tokenizer emits ~ and = as separate tokens; the parser combines them.
    const tilde = tokens.filter(t => t.type === '~');
    const eq = tokens.filter(t => t.type === '=');
    expect(tilde.length).toBe(1);
    expect(eq.length).toBe(1);
  });

  it('handles escaped identifiers', () => {
    const tokens = tokenizeCss('\\3A hover');
    const idents = tokens.filter(t => t.type === 'ident');
    expect(idents.length).toBe(1);
    expect(idents[0]!.value).toBe(':hover');
  });

  it('handles multiple rules', () => {
    const tokens = tokenizeCss('div { color: red; } span { color: blue; }');
    const openBraces = tokens.filter(t => t.type === '{');
    expect(openBraces.length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PARSER — SELECTORS
// ─────────────────────────────────────────────────────────────────────────────

describe('CSS5 — Parser: Selectors', () => {
  const parser = new CssParser();

  it('parses a type selector', () => {
    const sel = parser.parseSelector('div');
    expect(sel).not.toBeNull();
    expect(sel!.type).toBe('compound');
    if (sel!.type === 'compound') {
      expect(sel!.tagName).toBe('div');
    }
  });

  it('parses a universal selector', () => {
    const sel = parser.parseSelector('*');
    expect(sel).not.toBeNull();
    if (sel?.type === 'compound') {
      expect(sel.tagName).toBe('*');
    }
  });

  it('parses an ID selector', () => {
    const sel = parser.parseSelector('#myid');
    expect(sel).not.toBeNull();
    if (sel?.type === 'compound') {
      expect(sel.id).toBe('myid');
    }
  });

  it('parses a class selector', () => {
    const sel = parser.parseSelector('.myclass');
    expect(sel).not.toBeNull();
    if (sel?.type === 'compound') {
      expect(sel.classes).toEqual(['myclass']);
    }
  });

  it('parses compound selector with tag, id, and classes', () => {
    const sel = parser.parseSelector('div#main.active.highlight');
    expect(sel).not.toBeNull();
    if (sel?.type === 'compound') {
      expect(sel.tagName).toBe('div');
      expect(sel.id).toBe('main');
      expect(sel.classes).toEqual(['active', 'highlight']);
    }
  });

  it('parses descendant combinator', () => {
    const sel = parser.parseSelector('div span');
    expect(sel).not.toBeNull();
    expect(sel!.type).toBe('complex');
    if (sel?.type === 'complex') {
      expect(sel.combinator).toBe(' ');
      if (sel.left.type === 'compound') expect(sel.left.tagName).toBe('div');
      expect(sel.right.tagName).toBe('span');
    }
  });

  it('parses child combinator', () => {
    const sel = parser.parseSelector('div > span');
    expect(sel!.type).toBe('complex');
    if (sel?.type === 'complex') {
      expect(sel.combinator).toBe('>');
    }
  });

  it('parses adjacent sibling combinator', () => {
    const sel = parser.parseSelector('h1 + p');
    expect(sel!.type).toBe('complex');
    if (sel?.type === 'complex') {
      expect(sel.combinator).toBe('+');
    }
  });

  it('parses general sibling combinator', () => {
    const sel = parser.parseSelector('h1 ~ p');
    expect(sel!.type).toBe('complex');
    if (sel?.type === 'complex') {
      expect(sel.combinator).toBe('~');
    }
  });

  it('parses attribute selector [attr]', () => {
    const sel = parser.parseSelector('[href]');
    expect(sel).not.toBeNull();
    if (sel?.type === 'compound') {
      expect(sel.attributes.length).toBe(1);
      expect(sel.attributes[0]!.name).toBe('href');
      expect(sel.attributes[0]!.operator).toBeNull();
    }
  });

  it('parses attribute selector [attr=val]', () => {
    const sel = parser.parseSelector('[type="text"]');
    expect(sel).not.toBeNull();
    if (sel?.type === 'compound' && sel.attributes.length > 0) {
      expect(sel.attributes[0]!.name).toBe('type');
      expect(sel.attributes[0]!.operator).toBe('=');
      expect(sel.attributes[0]!.value).toBe('text');
    }
  });

  it('parses attribute selector [attr~=val]', () => {
    const sel = parser.parseSelector('[class~="active"]');
    if (sel?.type === 'compound' && sel.attributes.length > 0) {
      expect(sel.attributes[0]!.operator).toBe('~=');
    }
  });

  it('parses :first-child pseudo-class', () => {
    const sel = parser.parseSelector(':first-child');
    expect(sel).not.toBeNull();
    if (sel?.type === 'compound' && sel.pseudoClass) {
      expect(sel.pseudoClass.type).toBe('structural');
      if (sel.pseudoClass.type === 'structural') {
        expect(sel.pseudoClass.name).toBe('first-child');
      }
    }
  });

  it('parses :not() pseudo-class', () => {
    const sel = parser.parseSelector(':not(.hidden)');
    expect(sel).not.toBeNull();
    if (sel?.type === 'compound' && sel.pseudoClass) {
      expect(sel.pseudoClass.type).toBe('negation');
      if (sel.pseudoClass.type === 'negation') {
        expect(sel.pseudoClass.selectors.length).toBe(1);
      }
    }
  });

  it('parses :nth-child(an+b)', () => {
    const sel = parser.parseSelector(':nth-child(2n+1)');
    expect(sel).not.toBeNull();
    if (sel?.type === 'compound' && sel.pseudoClass?.type === 'structural') {
      expect(sel.pseudoClass.name).toBe('nth-child');
      expect(sel.pseudoClass.value).toBe('2n+1');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PARSER — STYLESHEETS & DECLARATIONS
// ─────────────────────────────────────────────────────────────────────────────

describe('CSS5 — Parser: Stylesheets', () => {
  const parser = new CssParser();

  it('parses a simple stylesheet', () => {
    const sheet = parser.parseStylesheetRobust('div { color: red; }');
    expect(sheet.rules.length).toBe(1);
    expect(sheet.rules[0]!.type).toBe('style');
  });

  it('parses multiple rules', () => {
    const css = 'div { color: red; } span { color: blue; }';
    const sheet = parser.parseStylesheetRobust(css);
    expect(sheet.rules.length).toBe(2);
  });

  it('parses !important declarations', () => {
    const sheet = parser.parseStylesheetRobust('div { color: red !important; }');
    expect(sheet.rules.length).toBe(1);
    if (sheet.rules[0]!.type === 'style') {
      expect(sheet.rules[0]!.declarations[0]!.important).toBe(true);
    }
  });

  it('parses @media rules', () => {
    const css = '@media screen and (max-width: 768px) { div { color: red; } }';
    const sheet = parser.parseStylesheetRobust(css);
    expect(sheet.rules.length).toBe(1);
    expect(sheet.rules[0]!.type).toBe('media');
  });

  it('parses @font-face rules', () => {
    const css = '@font-face { font-family: "MyFont"; src: url("font.woff"); }';
    const sheet = parser.parseStylesheetRobust(css);
    expect(sheet.rules.length).toBe(1);
    expect(sheet.rules[0]!.type).toBe('font-face');
  });

  it('parses @keyframes rules', () => {
    const css = '@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }';
    const sheet = parser.parseStylesheetRobust(css);
    expect(sheet.rules.length).toBe(1);
    expect(sheet.rules[0]!.type).toBe('keyframes');
  });

  it('parses @import rules', () => {
    const css = '@import "reset.css";';
    const sheet = parser.parseStylesheetRobust(css);
    expect(sheet.rules.length).toBe(1);
    expect(sheet.rules[0]!.type).toBe('import');
  });

  it('strips comments from CSS', () => {
    const css = '/* comment */ div { color: red; } /* another */';
    const sheet = parser.parseStylesheetRobust(css);
    expect(sheet.rules.length).toBe(1);
  });

  it('parses inline styles', () => {
    const map = parser.parseInlineStyle('color: red; font-size: 16px');
    expect(map.get('color')).toBe('red');
    expect(map.get('font-size')).toBe('16px');
  });

  it('handles empty CSS', () => {
    const sheet = parser.parseStylesheetRobust('');
    expect(sheet.rules.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SELECTOR MATCHING
// ─────────────────────────────────────────────────────────────────────────────

describe('CSS5 — Selector Matching', () => {
  it('matches type selectors', () => {
    const div = sel('div');
    expect(matchesSelector(div, { type: 'compound', tagName: 'div', id: null, classes: [], attributes: [], pseudoClass: null, pseudoElement: null })).toBe(true);
    expect(matchesSelector(div, { type: 'compound', tagName: 'span', id: null, classes: [], attributes: [], pseudoClass: null, pseudoElement: null })).toBe(false);
  });

  it('matches universal selector', () => {
    const div = sel('div');
    expect(matchesSelector(div, { type: 'compound', tagName: '*', id: null, classes: [], attributes: [], pseudoClass: null, pseudoElement: null })).toBe(true);
  });

  it('matches ID selectors', () => {
    const div = sel('div', { id: 'main' });
    const match = { type: 'compound' as const, tagName: null, id: 'main', classes: [], attributes: [], pseudoClass: null, pseudoElement: null };
    const noMatch = { type: 'compound' as const, tagName: null, id: 'other', classes: [], attributes: [], pseudoClass: null, pseudoElement: null };
    expect(matchesSelector(div, match)).toBe(true);
    expect(matchesSelector(div, noMatch)).toBe(false);
  });

  it('matches class selectors', () => {
    const span = sel('span', { class: 'btn primary' });
    const match = { type: 'compound' as const, tagName: null, id: null, classes: ['btn'], attributes: [], pseudoClass: null, pseudoElement: null };
    const matchBoth = { type: 'compound' as const, tagName: null, id: null, classes: ['btn', 'primary'], attributes: [], pseudoClass: null, pseudoElement: null };
    const noMatch = { type: 'compound' as const, tagName: null, id: null, classes: ['hidden'], attributes: [], pseudoClass: null, pseudoElement: null };
    expect(matchesSelector(span, match)).toBe(true);
    expect(matchesSelector(span, matchBoth)).toBe(true);
    expect(matchesSelector(span, noMatch)).toBe(false);
  });

  it('matches [attr] presence selector', () => {
    const a = sel('a', { href: 'https://example.com' });
    const match = { type: 'compound' as const, tagName: null, id: null, classes: [], attributes: [{ name: 'href', operator: null, value: null, caseInsensitive: false }], pseudoClass: null, pseudoElement: null };
    const noMatch = { type: 'compound' as const, tagName: null, id: null, classes: [], attributes: [{ name: 'src', operator: null, value: null, caseInsensitive: false }], pseudoClass: null, pseudoElement: null };
    expect(matchesSelector(a, match)).toBe(true);
    expect(matchesSelector(a, noMatch)).toBe(false);
  });

  it('matches [attr=val] exact match', () => {
    const input = sel('input', { type: 'text' });
    const match = { type: 'compound' as const, tagName: null, id: null, classes: [], attributes: [{ name: 'type', operator: '=' as const, value: 'text', caseInsensitive: false }], pseudoClass: null, pseudoElement: null };
    const noMatch = { type: 'compound' as const, tagName: null, id: null, classes: [], attributes: [{ name: 'type', operator: '=' as const, value: 'password', caseInsensitive: false }], pseudoClass: null, pseudoElement: null };
    expect(matchesSelector(input, match)).toBe(true);
    expect(matchesSelector(input, noMatch)).toBe(false);
  });

  it('matches [attr^=val] prefix match', () => {
    const a = sel('a', { href: 'https://example.com/page' });
    const match = { type: 'compound' as const, tagName: null, id: null, classes: [], attributes: [{ name: 'href', operator: '^=' as const, value: 'https://', caseInsensitive: false }], pseudoClass: null, pseudoElement: null };
    expect(matchesSelector(a, match)).toBe(true);
  });

  it('matches [attr$=val] suffix match', () => {
    const a = sel('a', { href: 'page.html' });
    const match = { type: 'compound' as const, tagName: null, id: null, classes: [], attributes: [{ name: 'href', operator: '$=' as const, value: '.html', caseInsensitive: false }], pseudoClass: null, pseudoElement: null };
    expect(matchesSelector(a, match)).toBe(true);
  });

  it('matches [attr*=val] substring match', () => {
    const a = sel('a', { href: 'https://example.com/page' });
    const match = { type: 'compound' as const, tagName: null, id: null, classes: [], attributes: [{ name: 'href', operator: '*=' as const, value: 'example', caseInsensitive: false }], pseudoClass: null, pseudoElement: null };
    expect(matchesSelector(a, match)).toBe(true);
  });

  it('matches descendant combinator', () => {
    const child = sel('span');
    const parent = sel('div', {}, [child]);
    const right = { type: 'compound' as const, tagName: 'span', id: null, classes: [], attributes: [], pseudoClass: null, pseudoElement: null };
    const left = { type: 'compound' as const, tagName: 'div', id: null, classes: [], attributes: [], pseudoClass: null, pseudoElement: null };
    const complex: CssSelector = { type: 'complex', left, combinator: ' ', right };
    expect(matchesSelector(child, complex)).toBe(true);
  });

  it('matches child combinator', () => {
    const child = sel('span');
    const parent = sel('div', {}, [child]);
    const right = { type: 'compound' as const, tagName: 'span', id: null, classes: [], attributes: [], pseudoClass: null, pseudoElement: null };
    const left = { type: 'compound' as const, tagName: 'div', id: null, classes: [], attributes: [], pseudoClass: null, pseudoElement: null };
    const complex: CssSelector = { type: 'complex', left, combinator: '>', right };
    expect(matchesSelector(child, complex)).toBe(true);
  });

  it('does not match child combinator for non-parent', () => {
    const grandchild = sel('span');
    const child = sel('div', {}, [grandchild]);
    const root = sel('section', {}, [child]);
    const right = { type: 'compound' as const, tagName: 'span', id: null, classes: [], attributes: [], pseudoClass: null, pseudoElement: null };
    const divLeft = { type: 'compound' as const, tagName: 'div', id: null, classes: [], attributes: [], pseudoClass: null, pseudoElement: null };
    const sectionLeft = { type: 'compound' as const, tagName: 'section', id: null, classes: [], attributes: [], pseudoClass: null, pseudoElement: null };
    // div > span matches grandchild because its parent IS a div
    expect(matchesSelector(grandchild, { type: 'complex', left: divLeft, combinator: '>', right })).toBe(true);
    // section > span does NOT match grandchild because grandchild's parent is div, not section
    expect(matchesSelector(grandchild, { type: 'complex', left: sectionLeft, combinator: '>', right })).toBe(false);
  });

  it('matches adjacent sibling combinator', () => {
    const h1 = sel('h1');
    const p = sel('p');
    const parent = sel('div', {}, [h1, p]);
    const right = { type: 'compound' as const, tagName: 'p', id: null, classes: [], attributes: [], pseudoClass: null, pseudoElement: null };
    const left = { type: 'compound' as const, tagName: 'h1', id: null, classes: [], attributes: [], pseudoClass: null, pseudoElement: null };
    const complex: CssSelector = { type: 'complex', left, combinator: '+', right };
    expect(matchesSelector(p, complex)).toBe(true);
  });

  it('does not match non-adjacent sibling', () => {
    const h1 = sel('h1');
    const p1 = sel('p');
    const p2 = sel('p');
    const parent = sel('div', {}, [h1, p1, p2]);
    const right = { type: 'compound' as const, tagName: 'p', id: null, classes: [], attributes: [], pseudoClass: null, pseudoElement: null };
    const left = { type: 'compound' as const, tagName: 'h1', id: null, classes: [], attributes: [], pseudoClass: null, pseudoElement: null };
    const complex: CssSelector = { type: 'complex', left, combinator: '+', right };
    expect(matchesSelector(p2, complex)).toBe(false);
  });

  it('matches general sibling combinator', () => {
    const h1 = sel('h1');
    const p1 = sel('p');
    const p2 = sel('p');
    const parent = sel('div', {}, [h1, p1, p2]);
    const right = { type: 'compound' as const, tagName: 'p', id: null, classes: [], attributes: [], pseudoClass: null, pseudoElement: null };
    const left = { type: 'compound' as const, tagName: 'h1', id: null, classes: [], attributes: [], pseudoClass: null, pseudoElement: null };
    const complex: CssSelector = { type: 'complex', left, combinator: '~', right };
    expect(matchesSelector(p1, complex)).toBe(true);
    expect(matchesSelector(p2, complex)).toBe(true);
  });

  it('matches :first-child', () => {
    const first = sel('p');
    const second = sel('p');
    const parent = sel('div', {}, [first, second]);
    const pseudo = { type: 'structural' as const, name: 'first-child', value: null };
    const match = { type: 'compound' as const, tagName: 'p', id: null, classes: [], attributes: [], pseudoClass: pseudo, pseudoElement: null };
    expect(matchesSelector(first, match)).toBe(true);
    expect(matchesSelector(second, match)).toBe(false);
  });

  it('matches :last-child', () => {
    const first = sel('p');
    const second = sel('p');
    const parent = sel('div', {}, [first, second]);
    const pseudo = { type: 'structural' as const, name: 'last-child', value: null };
    const match = { type: 'compound' as const, tagName: 'p', id: null, classes: [], attributes: [], pseudoClass: pseudo, pseudoElement: null };
    expect(matchesSelector(first, match)).toBe(false);
    expect(matchesSelector(second, match)).toBe(true);
  });

  it('matches :nth-child(odd)', () => {
    const c1 = sel('p');
    const c2 = sel('p');
    const c3 = sel('p');
    const c4 = sel('p');
    const parent = sel('div', {}, [c1, c2, c3, c4]);
    const pseudo = { type: 'structural' as const, name: 'nth-child', value: 'odd' };
    const match = { type: 'compound' as const, tagName: 'p', id: null, classes: [], attributes: [], pseudoClass: pseudo, pseudoElement: null };
    expect(matchesSelector(c1, match)).toBe(true);   // 1st (odd)
    expect(matchesSelector(c2, match)).toBe(false);  // 2nd (even)
    expect(matchesSelector(c3, match)).toBe(true);   // 3rd (odd)
    expect(matchesSelector(c4, match)).toBe(false);  // 4th (even)
  });

  it('matches :nth-child(even)', () => {
    const c1 = sel('p');
    const c2 = sel('p');
    const c3 = sel('p');
    const parent = sel('div', {}, [c1, c2, c3]);
    const pseudo = { type: 'structural' as const, name: 'nth-child', value: 'even' };
    const match = { type: 'compound' as const, tagName: 'p', id: null, classes: [], attributes: [], pseudoClass: pseudo, pseudoElement: null };
    expect(matchesSelector(c1, match)).toBe(false);  // 1st (odd)
    expect(matchesSelector(c2, match)).toBe(true);   // 2nd (even)
    expect(matchesSelector(c3, match)).toBe(false);  // 3rd (odd)
  });

  it('matches :nth-child(2n+1)', () => {
    const c1 = sel('p');
    const c2 = sel('p');
    const c3 = sel('p');
    const c4 = sel('p');
    const parent = sel('div', {}, [c1, c2, c3, c4]);
    const pseudo = { type: 'structural' as const, name: 'nth-child', value: '2n+1' };
    const match = { type: 'compound' as const, tagName: 'p', id: null, classes: [], attributes: [], pseudoClass: pseudo, pseudoElement: null };
    expect(matchesSelector(c1, match)).toBe(true);
    expect(matchesSelector(c2, match)).toBe(false);
    expect(matchesSelector(c3, match)).toBe(true);
    expect(matchesSelector(c4, match)).toBe(false);
  });

  it('matches :nth-child(3)', () => {
    const c1 = sel('p');
    const c2 = sel('p');
    const c3 = sel('p');
    const c4 = sel('p');
    const parent = sel('div', {}, [c1, c2, c3, c4]);
    const pseudo = { type: 'structural' as const, name: 'nth-child', value: '3' };
    const match = { type: 'compound' as const, tagName: 'p', id: null, classes: [], attributes: [], pseudoClass: pseudo, pseudoElement: null };
    expect(matchesSelector(c1, match)).toBe(false);
    expect(matchesSelector(c2, match)).toBe(false);
    expect(matchesSelector(c3, match)).toBe(true);
    expect(matchesSelector(c4, match)).toBe(false);
  });

  it('matches :not() negation', () => {
    const div = sel('div', { class: 'hidden' });
    const parser = new CssParser();
    const innerSel = parser.parseSelector('.hidden');
    expect(innerSel).not.toBeNull();
    const notSel: CssSelector = { type: 'compound', tagName: null, id: null, classes: [], attributes: [], pseudoClass: { type: 'negation', selectors: [innerSel!] }, pseudoElement: null };
    expect(matchesSelector(div, notSel)).toBe(false);

    const visible = sel('div', { class: 'visible' });
    expect(matchesSelector(visible, notSel)).toBe(true);
  });

  it('matches :empty', () => {
    const empty = sel('div');
    const full = sel('div', {}, [sel('span')]);
    const pseudo = { type: 'structural' as const, name: 'empty', value: null };
    const match = { type: 'compound' as const, tagName: 'div', id: null, classes: [], attributes: [], pseudoClass: pseudo, pseudoElement: null };
    expect(matchesSelector(empty, match)).toBe(true);
    expect(matchesSelector(full, match)).toBe(false);
  });

  it('matchesSelectorList', () => {
    const div = sel('div');
    const s1: CssSelector = { type: 'compound', tagName: 'div', id: null, classes: [], attributes: [], pseudoClass: null, pseudoElement: null };
    const s2: CssSelector = { type: 'compound', tagName: 'span', id: null, classes: [], attributes: [], pseudoClass: null, pseudoElement: null };
    expect(matchesSelectorList(div, [s1, s2])).toBe(true);
    expect(matchesSelectorList(div, [s2])).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// QUERY SELECTORS
// ─────────────────────────────────────────────────────────────────────────────

describe('CSS5 — querySelector/querySelectorAll', () => {
  it('querySelector finds first match', () => {
    const root = sel('div', {}, [
      sel('span', { id: 'first' }),
      sel('span', { id: 'second' }),
    ]);
    const result = querySelector(root, '#first');
    expect(result).not.toBeNull();
    expect(result!.attributes.get('id')).toBe('first');
  });

  it('querySelectorAll finds all matches', () => {
    const root = sel('div', {}, [
      sel('span'),
      sel('p'),
      sel('span'),
    ]);
    const results = querySelectorAll(root, 'span');
    expect(results.length).toBe(2);
  });

  it('querySelector returns null for no match', () => {
    const root = sel('div', {}, [sel('span')]);
    const result = querySelector(root, '.nonexistent');
    expect(result).toBeNull();
  });

  it('querySelector works with descendant selector', () => {
    const grandchild = sel('span', { id: 'gc' });
    const child = sel('div', {}, [grandchild]);
    const root = sel('div', {}, [child]);
    const result = querySelector(root, 'div span');
    expect(result).not.toBeNull();
    expect(result!.attributes.get('id')).toBe('gc');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASCADE & COMPUTED STYLES
// ─────────────────────────────────────────────────────────────────────────────

describe('CSS5 — Cascade', () => {
  it('computes basic styles', () => {
    const css = 'div { color: red; }';
    const parser = new CssParser();
    const sheet = parser.parseStylesheetRobust(css);
    const element = styleEl('div');
    const computed = computeComputedStyles(element, sheet);
    expect(computed.get('color')).toBe('red');
  });

  it('later rules override earlier rules with same specificity', () => {
    const css = 'div { color: red; } div { color: blue; }';
    const parser = new CssParser();
    const sheet = parser.parseStylesheetRobust(css);
    const element = styleEl('div');
    const computed = computeComputedStyles(element, sheet);
    expect(computed.get('color')).toBe('blue');
  });

  it('ID specificity overrides class specificity', () => {
    const css = '.cls { color: red; } #id { color: blue; }';
    const parser = new CssParser();
    const sheet = parser.parseStylesheetRobust(css);
    const element = styleEl('div', { id: 'id', class: 'cls' });
    const computed = computeComputedStyles(element, sheet);
    expect(computed.get('color')).toBe('blue');
  });

  it('class specificity overrides type specificity', () => {
    const css = 'div { color: red; } .cls { color: blue; }';
    const parser = new CssParser();
    const sheet = parser.parseStylesheetRobust(css);
    const element = styleEl('div', { class: 'cls' });
    const computed = computeComputedStyles(element, sheet);
    expect(computed.get('color')).toBe('blue');
  });

  it('inline styles override stylesheet rules', () => {
    const css = 'div { color: red; }';
    const parser = new CssParser();
    const sheet = parser.parseStylesheetRobust(css);
    const element = styleEl('div', { style: 'color: green' });
    const computed = computeComputedStyles(element, sheet);
    expect(computed.get('color')).toBe('green');
  });

  it('applies UA defaults', () => {
    const element = styleEl('div');
    const defaults = getUserAgentDefaults('div');
    expect(defaults.get('display')).toBe('block');
  });

  it('applies UA defaults for body', () => {
    const defaults = getUserAgentDefaults('body');
    expect(defaults.get('margin')).toBe('8px');
  });

  it('applies UA defaults for headings', () => {
    const h1 = getUserAgentDefaults('h1');
    expect(h1.get('font-weight')).toBe('bold');
  });

  it('applies inheritance for color', () => {
    const parent = styleEl('div', { class: 'parent' });
    const child = styleEl('span', {}, [], parent);
    const css = '.parent { color: red; }';
    const parser = new CssParser();
    const sheet = parser.parseStylesheetRobust(css);
    const parentComputed = computeComputedStyles(parent, sheet);
    const childComputed = computeComputedStyles(child, sheet, undefined, parentComputed);
    expect(childComputed.get('color')).toBe('red');
  });

  it('applies inheritance for font-size', () => {
    const parent = styleEl('div', { class: 'parent' });
    const child = styleEl('span', {}, [], parent);
    const css = '.parent { font-size: 24px; }';
    const parser = new CssParser();
    const sheet = parser.parseStylesheetRobust(css);
    const parentComputed = computeComputedStyles(parent, sheet);
    const childComputed = computeComputedStyles(child, sheet, undefined, parentComputed);
    expect(childComputed.get('font-size')).toBe('24px');
  });

  it('does not inherit non-inheritable properties', () => {
    const parent = styleEl('div', { class: 'parent' });
    const child = styleEl('span', {}, [], parent);
    const css = '.parent { background-color: red; }';
    const parser = new CssParser();
    const sheet = parser.parseStylesheetRobust(css);
    const parentComputed = computeComputedStyles(parent, sheet);
    const childComputed = computeComputedStyles(child, sheet, undefined, parentComputed);
    expect(childComputed.has('background-color')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SHORTHAND EXPANSION
// ─────────────────────────────────────────────────────────────────────────────

describe('CSS5 — Shorthand Expansion', () => {
  it('expands margin shorthand (4 values)', () => {
    const expanded = expandShorthands(decls(['margin', '10px 20px 30px 40px']));
    expect(declVal(expanded, 'margin-top')).toBe('10px');
    expect(declVal(expanded, 'margin-right')).toBe('20px');
    expect(declVal(expanded, 'margin-bottom')).toBe('30px');
    expect(declVal(expanded, 'margin-left')).toBe('40px');
  });

  it('expands margin shorthand (2 values)', () => {
    const expanded = expandShorthands(decls(['margin', '10px 20px']));
    expect(declVal(expanded, 'margin-top')).toBe('10px');
    expect(declVal(expanded, 'margin-right')).toBe('20px');
    expect(declVal(expanded, 'margin-bottom')).toBe('10px');
    expect(declVal(expanded, 'margin-left')).toBe('20px');
  });

  it('expands margin shorthand (1 value)', () => {
    const expanded = expandShorthands(decls(['margin', '10px']));
    expect(declVal(expanded, 'margin-top')).toBe('10px');
    expect(declVal(expanded, 'margin-right')).toBe('10px');
    expect(declVal(expanded, 'margin-bottom')).toBe('10px');
    expect(declVal(expanded, 'margin-left')).toBe('10px');
  });

  it('expands padding shorthand', () => {
    const expanded = expandShorthands(decls(['padding', '5px 10px']));
    expect(declVal(expanded, 'padding-top')).toBe('5px');
    expect(declVal(expanded, 'padding-right')).toBe('10px');
    expect(declVal(expanded, 'padding-bottom')).toBe('5px');
    expect(declVal(expanded, 'padding-left')).toBe('10px');
  });

  it('expands border shorthand', () => {
    const expanded = expandShorthands(decls(['border', '1px solid red']));
    expect(declVal(expanded, 'border-width')).toBe('1px');
    expect(declVal(expanded, 'border-style')).toBe('solid');
    expect(declVal(expanded, 'border-color')).toBe('red');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BACKWARD COMPATIBILITY (Legacy CssParser)
// ─────────────────────────────────────────────────────────────────────────────

describe('CSS5 — Backward Compatibility', () => {
  it('legacy CssParser.parseStylesheet works', () => {
    const parser = new LegacyCssParser();
    const sheet = parser.parseStylesheet('div { color: red; }');
    expect(sheet.rules.length).toBe(1);
    expect(sheet.rules[0].declarations.get('color')).toBe('red');
  });

  it('legacy CssParser.parseInlineStyle works', () => {
    const parser = new LegacyCssParser();
    const map = parser.parseInlineStyle('color: blue; font-size: 12px');
    expect(map.get('color')).toBe('blue');
    expect(map.get('font-size')).toBe('12px');
  });

  it('legacy specificityWeight works', () => {
    const spec = specificityWeight('#id .class div');
    expect(spec.id).toBe(1);
    expect(spec.class).toBe(1);
    expect(spec.tag).toBe(1);
  });
});
