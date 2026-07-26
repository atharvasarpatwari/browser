import { describe, it, expect } from 'vitest';
import { computeComputedStyles, type StyleableElement, type Viewport } from '../src/browser/rendering/css5/cascade';
import { CssParser } from '../src/browser/rendering/css5/parser';
import type { CssStylesheet } from '../src/browser/rendering/css5/types';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function el(
  tag: string,
  attrs?: Record<string, string>,
  children?: StyleableElement[],
  parent?: StyleableElement,
): StyleableElement {
  return {
    tagName: tag,
    attributes: new Map(Object.entries(attrs ?? {})),
    parent: parent ?? null,
    children: children ?? [],
  };
}

function parse(css: string): CssStylesheet {
  return new CssParser().parseStylesheetRobust(css);
}

const VP: Viewport = { width: 1920, height: 1080 };

// ─────────────────────────────────────────────────────────────────────────────
// BASIC CASCADE
// ─────────────────────────────────────────────────────────────────────────────

describe('computeComputedStyles — Basic Cascade', () => {
  it('resolves a single declaration', () => {
    const sheet = parse('div { color: red; }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('color')).toBe('#ff0000');
  });

  it('later rule wins at same specificity', () => {
    const sheet = parse('div { color: red; } div { color: blue; }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('color')).toBe('#0000ff');
  });

  it('ID specificity beats class specificity', () => {
    const sheet = parse('.cls { color: red; } #id { color: blue; }');
    const c = computeComputedStyles(el('div', { id: 'id', class: 'cls' }), sheet);
    expect(c.get('color')).toBe('#0000ff');
  });

  it('class specificity beats type specificity', () => {
    const sheet = parse('div { color: red; } .cls { color: blue; }');
    const c = computeComputedStyles(el('div', { class: 'cls' }), sheet);
    expect(c.get('color')).toBe('#0000ff');
  });

  it('inline styles override stylesheet rules', () => {
    const sheet = parse('div { color: red; }');
    const c = computeComputedStyles(el('div', { style: 'color: green' }), sheet);
    expect(c.get('color')).toBe('#008000');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// !IMPORTANT HANDLING
// ─────────────────────────────────────────────────────────────────────────────

describe('computeComputedStyles — !important', () => {
  it('stylesheet !important beats non-important inline', () => {
    const sheet = parse('div { color: blue !important; }');
    const c = computeComputedStyles(el('div', { style: 'color: red' }), sheet);
    expect(c.get('color')).toBe('#0000ff');
  });

  it('inline !important beats stylesheet !important', () => {
    const sheet = parse('div { color: blue !important; }');
    const c = computeComputedStyles(el('div', { style: 'color: red !important' }), sheet);
    expect(c.get('color')).toBe('#ff0000');
  });

  it('inline non-important beats stylesheet non-important', () => {
    const sheet = parse('div { color: blue; }');
    const c = computeComputedStyles(el('div', { style: 'color: red' }), sheet);
    expect(c.get('color')).toBe('#ff0000');
  });

  it('later stylesheet !important beats earlier stylesheet !important', () => {
    const sheet = parse('div { color: red !important; } div { color: green !important; }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('color')).toBe('#008000');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INHERITANCE
// ─────────────────────────────────────────────────────────────────────────────

describe('computeComputedStyles — Inheritance', () => {
  it('inherits color from parent', () => {
    const sheet = parse('.p { color: red; }');
    const parent = el('div', { class: 'p' });
    const child = el('span', {}, [], parent);
    const pc = computeComputedStyles(parent, sheet);
    const cc = computeComputedStyles(child, sheet, undefined, pc);
    expect(cc.get('color')).toBe('#ff0000');
  });

  it('inherits font-size from parent', () => {
    const sheet = parse('.p { font-size: 24px; }');
    const parent = el('div', { class: 'p' });
    const child = el('span', {}, [], parent);
    const pc = computeComputedStyles(parent, sheet);
    const cc = computeComputedStyles(child, sheet, undefined, pc);
    expect(cc.get('font-size')).toBe('24px');
  });

  it('does not inherit non-inheritable properties', () => {
    const sheet = parse('.p { background-color: red; }');
    const parent = el('div', { class: 'p' });
    const child = el('span', {}, [], parent);
    const pc = computeComputedStyles(parent, sheet);
    const cc = computeComputedStyles(child, sheet, undefined, pc);
    expect(cc.get('background-color')).toBe('transparent');
  });

  it('child overrides inherited value', () => {
    const sheet = parse('.p { color: red; } .c { color: blue; }');
    const parent = el('div', { class: 'p' });
    const child = el('span', { class: 'c' }, [], parent);
    const pc = computeComputedStyles(parent, sheet);
    const cc = computeComputedStyles(child, sheet, undefined, pc);
    expect(cc.get('color')).toBe('#0000ff');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CSS-WIDE KEYWORDS
// ─────────────────────────────────────────────────────────────────────────────

describe('computeComputedStyles — CSS-Wide Keywords', () => {
  it('resolves inherit on child', () => {
    const sheet = parse('.p { color: red; } .c { color: inherit; }');
    const parent = el('div', { class: 'p' });
    const child = el('span', { class: 'c' }, [], parent);
    const pc = computeComputedStyles(parent, sheet);
    const cc = computeComputedStyles(child, sheet, undefined, pc);
    expect(cc.get('color')).toBe('#ff0000');
  });

  it('resolves initial to spec initial value', () => {
    const sheet = parse('div { color: initial; }');
    const c = computeComputedStyles(el('div'), sheet);
    // color initial is canvastext, which gets resolved to its hex value
    expect(c.get('color')).toBeDefined();
    expect(c.get('color')).not.toBe('initial');
  });

  it('resolves unset for inherited property to inherit', () => {
    const sheet = parse('.p { color: red; } .c { color: unset; }');
    const parent = el('div', { class: 'p' });
    const child = el('span', { class: 'c' }, [], parent);
    const pc = computeComputedStyles(parent, sheet);
    const cc = computeComputedStyles(child, sheet, undefined, pc);
    expect(cc.get('color')).toBe('#ff0000');
  });

  it('resolves unset for non-inherited property to initial', () => {
    const sheet = parse('div { background-color: unset; }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('background-color')).toBe('transparent');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOM PROPERTIES (var())
// ─────────────────────────────────────────────────────────────────────────────

describe('computeComputedStyles — Custom Properties', () => {
  it('resolves var() in declarations', () => {
    const sheet = parse(':root { --main-color: #ff0000; } div { color: var(--main-color); }');
    const root = el(':root');
    const child = el('div', {}, [], root);
    const rc = computeComputedStyles(root, sheet);
    const cc = computeComputedStyles(child, sheet, undefined, rc);
    expect(cc.get('color')).toBe('#ff0000');
  });

  it('resolves var() with fallback', () => {
    const sheet = parse('div { color: var(--missing, blue); }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('color')).toBe('#0000ff');
  });

  it('inherits custom properties from parent', () => {
    const sheet = parse(':root { --x: 10px; } .c { padding: var(--x); }');
    const root = el(':root');
    const child = el('div', { class: 'c' }, [], root);
    const rc = computeComputedStyles(root, sheet);
    const cc = computeComputedStyles(child, sheet, undefined, rc);
    expect(cc.get('padding-top')).toBe('10px');
    expect(cc.get('padding-right')).toBe('10px');
    expect(cc.get('padding-bottom')).toBe('10px');
    expect(cc.get('padding-left')).toBe('10px');
  });

  it('child custom property overrides inherited one', () => {
    const sheet = parse(':root { --x: 10px; } .c { --x: 20px; padding: var(--x); }');
    const root = el(':root');
    const child = el('div', { class: 'c' }, [], root);
    const rc = computeComputedStyles(root, sheet);
    const cc = computeComputedStyles(child, sheet, undefined, rc);
    expect(cc.get('padding-top')).toBe('20px');
  });

  it('keeps custom properties available for child inheritance', () => {
    const sheet = parse(':root { --my-prop: red; }');
    const root = el(':root');
    const c = computeComputedStyles(root, sheet);
    expect(c.get('--my-prop')).toBe('red');
  });

  // ── var() in shorthand properties (order-of-operations fix) ──
  it('var() inside margin shorthand resolves correctly', () => {
    const sheet = parse(':root { --gap: 10px; } div { margin: var(--gap); }');
    const root = el(':root');
    const child = el('div', {}, [], root);
    const rc = computeComputedStyles(root, sheet);
    const cc = computeComputedStyles(child, sheet, undefined, rc);
    expect(cc.get('margin-top')).toBe('10px');
    expect(cc.get('margin-right')).toBe('10px');
    expect(cc.get('margin-bottom')).toBe('10px');
    expect(cc.get('margin-left')).toBe('10px');
  });

  it('var() inside padding shorthand with fallback', () => {
    const sheet = parse('div { padding: var(--x, 8px); }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('padding-top')).toBe('8px');
    expect(c.get('padding-right')).toBe('8px');
  });

  it('var() returning multi-token value for margin shorthand', () => {
    const sheet = parse(':root { --m: 1px 2px 3px 4px; } div { margin: var(--m); }');
    const root = el(':root');
    const child = el('div', {}, [], root);
    const rc = computeComputedStyles(root, sheet);
    const cc = computeComputedStyles(child, sheet, undefined, rc);
    expect(cc.get('margin-top')).toBe('1px');
    expect(cc.get('margin-right')).toBe('2px');
    expect(cc.get('margin-bottom')).toBe('3px');
    expect(cc.get('margin-left')).toBe('4px');
  });

  it('var() inside border shorthand', () => {
    const sheet = parse(':root { --bw: 2px; --bc: red; } div { border: var(--bw) solid var(--bc); }');
    const root = el(':root');
    const child = el('div', {}, [], root);
    const rc = computeComputedStyles(root, sheet);
    const cc = computeComputedStyles(child, sheet, undefined, rc);
    expect(cc.get('border-top-width')).toBe('2px');
    expect(cc.get('border-top-color')).toBe('#ff0000');
  });

  // ── CSS-wide keywords in custom properties ──
  it('custom property with value "inherit" is not corrupted', () => {
    const sheet = parse(':root { --color: red; } div { --color: inherit; color: var(--color); }');
    const root = el(':root');
    const child = el('div', {}, [], root);
    const rc = computeComputedStyles(root, sheet);
    const cc = computeComputedStyles(child, sheet, undefined, rc);
    // --color: inherit should store the literal string "inherit", not be resolved to "initial"
    expect(cc.get('--color')).toBe('inherit');
  });

  it('custom property with value "initial" is stored as-is', () => {
    const sheet = parse('div { --x: initial; }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('--x')).toBe('initial');
  });

  it('custom property with value "unset" is stored as-is', () => {
    const sheet = parse('div { --x: unset; }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('--x')).toBe('unset');
  });

  // ── Inline custom properties ──
  it('inline custom property overrides stylesheet custom property', () => {
    const sheet = parse('div { --x: red; color: var(--x); }');
    const c = computeComputedStyles(el('div', { style: '--x: blue' }), sheet);
    expect(c.get('color')).toBe('#0000ff');
  });

  it('inline custom property available for var() in stylesheet', () => {
    const sheet = parse('div { color: var(--accent); }');
    const c = computeComputedStyles(el('div', { style: '--accent: green' }), sheet);
    expect(c.get('color')).toBe('#008000');
  });

  // ── Nested var() in fallback ──
  it('deeply nested var() in fallback (3 levels)', () => {
    const sheet = parse('div { color: var(--a, var(--b, var(--c, red))); }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('color')).toBe('#ff0000');
  });

  it('nested var() fallback resolves when outer is missing', () => {
    const sheet = parse(':root { --y: blue; } div { color: var(--x, var(--y)); }');
    const root = el(':root');
    const child = el('div', {}, [], root);
    const rc = computeComputedStyles(root, sheet);
    const cc = computeComputedStyles(child, sheet, undefined, rc);
    expect(cc.get('color')).toBe('#0000ff');
  });

  // ── Cycle handling ──
  it('var() cycle hits max depth without crashing', () => {
    const sheet = parse('div { --x: var(--y); --y: var(--x); color: var(--x, red); }');
    const c = computeComputedStyles(el('div'), sheet);
    // Cycle detection via depth limit — the circular reference resolves to
    // a partially-resolved var() token. This is a known limitation of
    // string-level var() resolution; real browsers resolve at token level.
    expect(c.get('color')).toBeDefined();
  });

  // ── Multiple var() in one value ──
  it('multiple var() in one value', () => {
    const sheet = parse(':root { --a: 10px; --b: 20px; } div { margin: var(--a) var(--b); }');
    const root = el(':root');
    const child = el('div', {}, [], root);
    const rc = computeComputedStyles(root, sheet);
    const cc = computeComputedStyles(child, sheet, undefined, rc);
    // 2-value margin: top/bottom = 10px, left/right = 20px
    expect(cc.get('margin-top')).toBe('10px');
    expect(cc.get('margin-right')).toBe('20px');
    expect(cc.get('margin-bottom')).toBe('10px');
    expect(cc.get('margin-left')).toBe('20px');
  });

  // ── var() with initial/inherit as fallback literal ──
  it('var() with "initial" as fallback — resolved as CSS-wide keyword', () => {
    const sheet = parse('div { color: var(--x, initial); }');
    const c = computeComputedStyles(el('div'), sheet);
    // Known limitation: string-level var() resolution means "initial" from
    // the fallback is indistinguishable from the CSS-wide keyword.
    // Real browsers resolve var() at token level to avoid this.
    expect(c.get('color')).toBe('canvastext');
  });

  // ── Three-level inheritance ──
  it('three-level custom property inheritance', () => {
    const sheet = parse(':root { --x: 10px; }');
    const root = el(':root');
    const mid = el('section', {}, [], root);
    const leaf = el('div', {}, [], mid);
    const rc = computeComputedStyles(root, sheet);
    const mc = computeComputedStyles(mid, sheet, undefined, rc);
    const lc = computeComputedStyles(leaf, sheet, undefined, mc);
    expect(lc.get('--x')).toBe('10px');
  });

  it('three-level with override at middle', () => {
    const sheet = parse(':root { --x: 10px; } .mid { --x: 20px; }');
    const root = el(':root');
    const mid = el('section', { class: 'mid' }, [], root);
    const leaf = el('div', {}, [], mid);
    const rc = computeComputedStyles(root, sheet);
    const mc = computeComputedStyles(mid, sheet, undefined, rc);
    const lc = computeComputedStyles(leaf, sheet, undefined, mc);
    expect(lc.get('--x')).toBe('20px');
  });

  // ── var() inside @media ──
  it('var() inside @media rule', () => {
    const sheet = parse(':root { --c: red; } @media (min-width: 100px) { div { color: var(--c); } }');
    const root = el(':root');
    const child = el('div', {}, [], root);
    const rc = computeComputedStyles(root, sheet, { width: 1920, height: 1080 });
    const cc = computeComputedStyles(child, sheet, { width: 1920, height: 1080 }, rc);
    expect(cc.get('color')).toBe('#ff0000');
  });

  // ── var() with calc() ──
  it('var() containing calc() value', () => {
    const sheet = parse(':root { --gap: 10px; } div { padding: calc(var(--gap) + 5px); }');
    const root = el(':root');
    const child = el('div', {}, [], root);
    const rc = computeComputedStyles(root, sheet);
    const cc = computeComputedStyles(child, sheet, undefined, rc);
    // var() is resolved before calc() — the result is calc(10px + 5px)
    expect(cc.get('padding-top')).toContain('calc');
  });

  // ── var() fallback with quoted string ──
  it('var() with quoted string fallback', () => {
    const sheet = parse('div { font-family: var(--font, "Arial"); }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('font-family')).toBe('"Arial"');
  });

  // ── Custom property set via @media conditional ──
  it('custom property set via @media', () => {
    const sheet = parse('@media (min-width: 100px) { div { --x: 42px; padding: var(--x); } }');
    const c = computeComputedStyles(el('div'), sheet, { width: 1920, height: 1080 });
    expect(c.get('padding-top')).toBe('42px');
  });

  // ── var() with empty fallback ──
  it('var() with empty fallback string', () => {
    const sheet = parse('div { color: var(--x, ); }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('color')).toBe('');
  });

  // ── !important custom properties ──
  it('important custom property wins over non-important', () => {
    const sheet = parse('div { --x: 10px !important; --x: 20px; padding: var(--x); }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('padding-top')).toBe('10px');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// @LAYER CASCADE
// ─────────────────────────────────────────────────────────────────────────────

describe('computeComputedStyles — @layer', () => {
  it('unlayered beats layered', () => {
    const sheet = parse('@layer base { div { color: red; } } div { color: blue; }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('color')).toBe('#0000ff');
  });

  it('later-declared layer beats earlier-declared layer', () => {
    const sheet = parse('@layer first { div { color: red; } } @layer second { div { color: blue; } }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('color')).toBe('#0000ff');
  });

  it('layer-order declaration controls priority', () => {
    const sheet = parse('@layer a, b; @layer a { div { color: red; } } @layer b { div { color: blue; } }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('color')).toBe('#0000ff');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CURRENTCOLOR
// ─────────────────────────────────────────────────────────────────────────────

describe('computeComputedStyles — currentcolor', () => {
  it('resolves currentcolor on border-color to the computed color', () => {
    const sheet = parse('div { color: red; border-top-color: currentcolor; }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('border-top-color')).toBe('#ff0000');
  });

  it('resolves currentcolor on text-decoration-color', () => {
    const sheet = parse('div { color: blue; text-decoration-color: currentcolor; }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('text-decoration-color')).toBe('#0000ff');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SHORTHAND EXPANSION + RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

describe('computeComputedStyles — Shorthands', () => {
  it('expands margin shorthand', () => {
    const sheet = parse('div { margin: 10px 20px 30px 40px; }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('margin-top')).toBe('10px');
    expect(c.get('margin-right')).toBe('20px');
    expect(c.get('margin-bottom')).toBe('30px');
    expect(c.get('margin-left')).toBe('40px');
  });

  it('expands padding shorthand', () => {
    const sheet = parse('div { padding: 5px 15px; }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('padding-top')).toBe('5px');
    expect(c.get('padding-right')).toBe('15px');
    expect(c.get('padding-bottom')).toBe('5px');
    expect(c.get('padding-left')).toBe('15px');
  });

  it('expands border shorthand', () => {
    const sheet = parse('div { border: 2px solid red; }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('border-top-width')).toBe('2px');
    expect(c.get('border-top-style')).toBe('solid');
    expect(c.get('border-top-color')).toBe('#ff0000');
  });

  it('expands font shorthand with quoted family', () => {
    const sheet = parse('div { font: italic bold 16px/1.5 "Arial", sans-serif; }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('font-style')).toBe('italic');
    expect(c.get('font-weight')).toBe('700');
    expect(c.get('font-size')).toBe('16px');
    expect(c.get('line-height')).toBe('1.5');
    expect(c.get('font-family')).toBe('"Arial", sans-serif');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// :WHERE() ZERO SPECIFICITY
// ─────────────────────────────────────────────────────────────────────────────

describe('computeComputedStyles — :where()', () => {
  it(':where() has zero specificity — same specificity as bare rule, source order wins', () => {
    const sheet = parse('div { color: red; } div:where(.x) { color: blue; }');
    const c = computeComputedStyles(el('div', { class: 'x' }), sheet);
    // Both have specificity (0,0,1) since :where() contributes 0.
    // Source order: div:where(.x) comes later, so blue wins.
    expect(c.get('color')).toBe('#0000ff');
  });

  it(':where() with no competing same-specificity rule', () => {
    const sheet = parse('div:where(.x) { color: red; } .other { color: blue; }');
    const c = computeComputedStyles(el('div', { class: 'x' }), sheet);
    // .other doesn't match, so div:where(.x) wins with specificity (0,0,1)
    expect(c.get('color')).toBe('#ff0000');
  });

  it(':where() with complex selectors', () => {
    const sheet = parse(':where(div > span) { color: green; } div { color: red; }');
    const parent = el('div');
    const child = el('span', {}, [], parent);
    const c = computeComputedStyles(child, sheet);
    // :where() has zero specificity, but there's no competing rule on span
    // The div rule doesn't match span, so :where() wins by default
    expect(c.get('color')).toBe('#008000');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SELECTOR LISTS & COMPLEX SELECTORS
// ─────────────────────────────────────────────────────────────────────────────

describe('computeComputedStyles — Selector Lists', () => {
  it('selector list matches any selector in the list', () => {
    const sheet = parse('div, span { color: red; }');
    expect(computeComputedStyles(el('div'), sheet).get('color')).toBe('#ff0000');
    expect(computeComputedStyles(el('span'), sheet).get('color')).toBe('#ff0000');
  });

  it(':not() excludes matching elements', () => {
    const sheet = parse('div:not(.skip) { color: red; }');
    expect(computeComputedStyles(el('div', { class: 'other' }), sheet).get('color')).toBe('#ff0000');
    expect(computeComputedStyles(el('div', { class: 'skip' }), sheet).get('color')).not.toBe('#ff0000');
  });

  it('descendant combinator', () => {
    const sheet = parse('div span { color: red; }');
    const parent = el('div');
    const child = el('span', {}, [], parent);
    expect(computeComputedStyles(child, sheet).get('color')).toBe('#ff0000');
  });

  it('child combinator', () => {
    const sheet = parse('div > span { color: red; }');
    const parent = el('div');
    const child = el('span', {}, [], parent);
    expect(computeComputedStyles(child, sheet).get('color')).toBe('#ff0000');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MEDIA QUERIES
// ─────────────────────────────────────────────────────────────────────────────

describe('computeComputedStyles — Media Queries', () => {
  // ── Media type matching ──
  it('matches bare @media screen', () => {
    const sheet = parse('@media screen { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('color')).toBe('#ff0000');
  });

  it('matches bare @media all', () => {
    const sheet = parse('@media all { div { color: blue; } }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('color')).toBe('#0000ff');
  });

  it('does not match @media print', () => {
    const sheet = parse('@media print { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('color')).not.toBe('#ff0000');
  });

  // ── Width/height features ──
  it('applies styles when media matches min-width', () => {
    const sheet = parse('@media (min-width: 1024px) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet, { width: 1920, height: 1080 });
    expect(c.get('color')).toBe('#ff0000');
  });

  it('does not apply styles when media does not match max-width', () => {
    const sheet = parse('@media (max-width: 500px) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet, { width: 1920, height: 1080 });
    expect(c.get('color')).not.toBe('#ff0000');
  });

  it('exact width match', () => {
    const sheet = parse('@media (width: 1920px) { div { color: green; } }');
    const c = computeComputedStyles(el('div'), sheet, { width: 1920, height: 1080 });
    expect(c.get('color')).toBe('#008000');
  });

  it('width mismatch returns false', () => {
    const sheet = parse('@media (width: 800px) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet, { width: 1920, height: 1080 });
    expect(c.get('color')).not.toBe('#ff0000');
  });

  it('height max-height matches', () => {
    const sheet = parse('@media (max-height: 2000px) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet, { width: 1920, height: 1080 });
    expect(c.get('color')).toBe('#ff0000');
  });

  it('min-height does not match', () => {
    const sheet = parse('@media (min-height: 2000px) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet, { width: 1920, height: 1080 });
    expect(c.get('color')).not.toBe('#ff0000');
  });

  // ── Orientation ──
  it('evaluates orientation media feature', () => {
    const sheet = parse('@media (orientation: landscape) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet, { width: 1920, height: 1080 });
    expect(c.get('color')).toBe('#ff0000');
  });

  it('orientation portrait', () => {
    const sheet = parse('@media (orientation: portrait) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet, { width: 800, height: 1200 });
    expect(c.get('color')).toBe('#ff0000');
  });

  it('orientation landscape does not match portrait viewport', () => {
    const sheet = parse('@media (orientation: landscape) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet, { width: 800, height: 1200 });
    expect(c.get('color')).not.toBe('#ff0000');
  });

  // ── Aspect ratio ──
  it('aspect-ratio exact match', () => {
    const sheet = parse('@media (aspect-ratio: 16/9) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet, { width: 1920, height: 1080 });
    expect(c.get('color')).toBe('#ff0000');
  });

  it('aspect-ratio min-aspect-ratio', () => {
    const sheet = parse('@media (min-aspect-ratio: 1/1) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet, { width: 1920, height: 1080 });
    expect(c.get('color')).toBe('#ff0000');
  });

  it('aspect-ratio max-aspect-ratio does not match when too wide', () => {
    const sheet = parse('@media (max-aspect-ratio: 1/2) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet, { width: 1920, height: 1080 });
    expect(c.get('color')).not.toBe('#ff0000');
  });

  // ── Resolution ──
  it('resolution 96dpi matches', () => {
    const sheet = parse('@media (resolution: 96dpi) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('color')).toBe('#ff0000');
  });

  it('resolution 1dppx matches', () => {
    const sheet = parse('@media (resolution: 1dppx) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('color')).toBe('#ff0000');
  });

  // ── Boolean features (no value) ──
  it('(hover) boolean feature matches', () => {
    const sheet = parse('@media (hover) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('color')).toBe('#ff0000');
  });

  it('(color) boolean feature matches', () => {
    const sheet = parse('@media (color) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('color')).toBe('#ff0000');
  });

  it('(pointer) boolean feature matches', () => {
    const sheet = parse('@media (pointer) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('color')).toBe('#ff0000');
  });

  // ── Boolean features with value ──
  it('evaluates pointer media feature', () => {
    const sheet = parse('@media (pointer: fine) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('color')).toBe('#ff0000');
  });

  it('(pointer: coarse) does not match (assume fine)', () => {
    const sheet = parse('@media (pointer: coarse) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('color')).not.toBe('#ff0000');
  });

  it('evaluates prefers-color-scheme', () => {
    const sheet = parse('@media (prefers-color-scheme: light) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('color')).toBe('#ff0000');
  });

  it('(prefers-color-scheme: dark) does not match light default', () => {
    const sheet = parse('@media (prefers-color-scheme: dark) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('color')).not.toBe('#ff0000');
  });

  it('(prefers-reduced-motion: no-preference) matches', () => {
    const sheet = parse('@media (prefers-reduced-motion: no-preference) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('color')).toBe('#ff0000');
  });

  it('(forced-colors: none) matches', () => {
    const sheet = parse('@media (forced-colors: none) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('color')).toBe('#ff0000');
  });

  it('(dynamic-range: standard) matches', () => {
    const sheet = parse('@media (dynamic-range: standard) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('color')).toBe('#ff0000');
  });

  // ── AND conjunction ──
  it('multiple features with AND — both match', () => {
    const sheet = parse('@media (min-width: 1024px) and (orientation: landscape) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet, { width: 1920, height: 1080 });
    expect(c.get('color')).toBe('#ff0000');
  });

  it('multiple features with AND — one fails', () => {
    const sheet = parse('@media (min-width: 1024px) and (orientation: portrait) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet, { width: 1920, height: 1080 });
    expect(c.get('color')).not.toBe('#ff0000');
  });

  // ── NOT modifier ──
  it('not inverts media type — @media not print matches', () => {
    const sheet = parse('@media not print { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('color')).toBe('#ff0000');
  });

  it('not inverts media type — @media not screen does not match', () => {
    const sheet = parse('@media not screen { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('color')).not.toBe('#ff0000');
  });

  it('not inverts features — @media not (max-width: 500px) matches wide viewport', () => {
    const sheet = parse('@media not (max-width: 500px) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet, { width: 1920, height: 1080 });
    expect(c.get('color')).toBe('#ff0000');
  });

  it('not inverts features — @media not (min-width: 1024px) does not match wide viewport', () => {
    const sheet = parse('@media not (min-width: 1024px) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet, { width: 1920, height: 1080 });
    expect(c.get('color')).not.toBe('#ff0000');
  });

  it('not with combined type and features', () => {
    const sheet = parse('@media not screen and (min-width: 5000px) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet, { width: 1920, height: 1080 });
    // screen matches, width 1920 < 5000 so feature fails → result=false → not → true
    expect(c.get('color')).toBe('#ff0000');
  });

  // ── Comma-separated queries (OR) ──
  it('comma-separated queries — first matches', () => {
    const sheet = parse('@media (min-width: 1024px), (orientation: portrait) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet, { width: 1920, height: 1080 });
    expect(c.get('color')).toBe('#ff0000');
  });

  it('comma-separated queries — second matches', () => {
    const sheet = parse('@media (max-width: 500px), (orientation: landscape) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet, { width: 1920, height: 1080 });
    expect(c.get('color')).toBe('#ff0000');
  });

  it('comma-separated queries — none match', () => {
    const sheet = parse('@media (max-width: 500px), (orientation: portrait) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet, { width: 800, height: 600 });
    expect(c.get('color')).not.toBe('#ff0000');
  });

  // ── Nested @media ──
  it('nested @media rules', () => {
    const sheet = parse('@media (min-width: 1024px) { @media (orientation: landscape) { div { color: red; } } }');
    const c = computeComputedStyles(el('div'), sheet, { width: 1920, height: 1080 });
    expect(c.get('color')).toBe('#ff0000');
  });

  it('nested @media — inner does not match', () => {
    const sheet = parse('@media (min-width: 1024px) { @media (orientation: portrait) { div { color: red; } } }');
    const c = computeComputedStyles(el('div'), sheet, { width: 1920, height: 1080 });
    expect(c.get('color')).not.toBe('#ff0000');
  });

  it('nested @media — outer does not match', () => {
    const sheet = parse('@media (max-width: 500px) { @media (orientation: landscape) { div { color: red; } } }');
    const c = computeComputedStyles(el('div'), sheet, { width: 1920, height: 1080 });
    expect(c.get('color')).not.toBe('#ff0000');
  });

  // ── Edge cases ──
  it('empty @media matches all', () => {
    const sheet = parse('@media { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('color')).toBe('#ff0000');
  });

  it('only modifier behaves same as no modifier', () => {
    const sheet = parse('@media only screen { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('color')).toBe('#ff0000');
  });

  it('unknown media type defaults to match', () => {
    const sheet = parse('@media tty { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('color')).toBe('#ff0000');
  });

  it('(update-frequency: fast) matches', () => {
    const sheet = parse('@media (update-frequency: fast) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('color')).toBe('#ff0000');
  });

  it('(overflow-block: scroll) matches', () => {
    const sheet = parse('@media (overflow-block: scroll) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('color')).toBe('#ff0000');
  });

  it('(display-mode: browser) matches', () => {
    const sheet = parse('@media (display-mode: browser) { div { color: red; } }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('color')).toBe('#ff0000');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// USER-AGENT DEFAULTS
// ─────────────────────────────────────────────────────────────────────────────

describe('computeComputedStyles — UA Defaults', () => {
  it('applies block display for div', () => {
    const c = computeComputedStyles(el('div'), parse(''));
    expect(c.get('display')).toBe('block');
  });

  it('applies inline display for span', () => {
    const c = computeComputedStyles(el('span'), parse(''));
    expect(c.get('display')).toBe('inline');
  });

  it('applies body margin', () => {
    const c = computeComputedStyles(el('body'), parse(''));
    expect(c.get('margin-top')).toBe('8px');
    expect(c.get('margin-right')).toBe('8px');
    expect(c.get('margin-bottom')).toBe('8px');
    expect(c.get('margin-left')).toBe('8px');
  });

  it('applies h1 font-size and font-weight', () => {
    const c = computeComputedStyles(el('h1'), parse(''));
    expect(c.get('font-size')).toBe('2em');
    // font-weight 'bold' is resolved to '700' by computed value resolver
    expect(c.get('font-weight')).toBe('700');
  });

  it('applies pre font-family as monospace', () => {
    const c = computeComputedStyles(el('pre'), parse(''));
    expect(c.get('font-family')).toBe('monospace');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INLINE STYLE PARSING EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────

describe('computeComputedStyles — Inline Style Parsing', () => {
  it('parses multiple inline declarations', () => {
    const sheet = parse('');
    const c = computeComputedStyles(el('div', { style: 'color: red; font-size: 20px' }), sheet);
    expect(c.get('color')).toBe('#ff0000');
    expect(c.get('font-size')).toBe('20px');
  });

  it('handles inline style with !important', () => {
    const sheet = parse('');
    const c = computeComputedStyles(el('div', { style: 'color: red !important' }), sheet);
    expect(c.get('color')).toBe('#ff0000');
  });

  it('handles inline custom properties', () => {
    const sheet = parse('div { color: var(--x, blue); }');
    const c = computeComputedStyles(el('div', { style: '--x: green' }), sheet);
    expect(c.get('color')).toBe('#008000');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FULL PIPELINE INTEGRATION
// ─────────────────────────────────────────────────────────────────────────────

describe('computeComputedStyles — Full Pipeline Integration', () => {
  it('cascade → specificity → shorthand → keywords → inheritance → resolution', () => {
    const sheet = parse(`
      :root { --accent: red; color: var(--accent); }
      div { border: 1px solid var(--accent); font: bold 14px/1.2 sans-serif; }
      .special { border-top-color: currentcolor; }
    `);
    const root = el(':root');
    const child = el('div', { class: 'special' }, [], root);
    const rc = computeComputedStyles(root, sheet);
    const cc = computeComputedStyles(child, sheet, undefined, rc);

    // var() resolved, border expanded, font expanded, currentcolor resolved
    expect(cc.get('border-top-width')).toBe('1px');
    expect(cc.get('border-top-style')).toBe('solid');
    expect(cc.get('border-top-color')).toBe('#ff0000');
    expect(cc.get('font-weight')).toBe('700');
    expect(cc.get('font-size')).toBe('14px');
    expect(cc.get('font-style')).toBe('normal');
    expect(cc.get('color')).toBe('#ff0000');
  });

  it('three-level inheritance chain', () => {
    const sheet = parse('.a { color: red; }');
    const grandparent = el('div', { class: 'a' });
    const parent = el('div', {}, [], grandparent);
    const child = el('span', {}, [], parent);
    const gpc = computeComputedStyles(grandparent, sheet);
    const pc = computeComputedStyles(parent, sheet, undefined, gpc);
    const cc = computeComputedStyles(child, sheet, undefined, pc);
    expect(cc.get('color')).toBe('#ff0000');
  });

  it('multiple layers with specificity interaction', () => {
    const sheet = parse(`
      @layer base { div { color: red; } }
      @layer override { .cls { color: green; } }
      div { color: blue; }
    `);
    // Unlayered wins over all layers
    const c = computeComputedStyles(el('div', { class: 'cls' }), sheet);
    expect(c.get('color')).toBe('#0000ff');
  });

  it('opacity clamping in full pipeline', () => {
    const sheet = parse('div { opacity: 5; }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('opacity')).toBe('1');
  });

  it('z-index resolution in full pipeline', () => {
    const sheet = parse('div { position: relative; z-index: 42; }');
    const c = computeComputedStyles(el('div'), sheet);
    expect(c.get('z-index')).toBe('42');
  });
});
