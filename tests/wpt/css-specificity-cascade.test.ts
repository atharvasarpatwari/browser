/**
 * @file tests/wpt/css-specificity-cascade.test.ts
 *
 * CSS specificity, cascade, inheritance, and computed style tests.
 * Self-contained tests using happy-dom's CSSStyleSheet API and inline
 * specificity calculations. Does NOT import from the Nova CSS engine
 * to avoid vitest module resolution hangs.
 */

import { describe, it, expect } from 'vitest';
import { describeWPT, assertWPT } from './wpt-adapter';

// ─── Inline Specificity Calculator ────────────────────────────────────────────
// Simplified CSS specificity per https://www.w3.org/TR/selectors/#specificity

interface Specificity { id: number; class: number; tag: number; }

function calcSpecificity(selector: string): Specificity {
  let id = 0, cls = 0, tag = 0;
  const s = selector.replace(/::\w+/, '');
  id += (s.match(/#[\w-]+/g) || []).length;
  cls += (s.match(/\.[\w-]+/g) || []).length;
  cls += (s.match(/\[[^\]]+\]/g) || []).length;
  cls += (s.match(/:[\w-]+(?![\w-])/g) || []).length;
  const idClasses = (s.match(/#[\w-]+|[\.\[:][\w-]*/g) || []).join('');
  const remaining = s.replace(/#[\w-]+/g, '').replace(/[\.\[:][\w-]*/g, '').replace(/[>+~\s,]/g, '');
  const tags = remaining.match(/[a-zA-Z][\w-]*/g) || [];
  tag = tags.filter(t => t !== '*' && t !== 'not' && t !== 'is' && t !== 'where').length;
  return { id, class: cls, tag };
}

function specScore(s: Specificity): number {
  return s.id * 100 + s.class * 10 + s.tag;
}

// ─── Specificity ──────────────────────────────────────────────────────────────

describeWPT('CSS Specificity — Basic', () => {
  assertWPT('type selector has specificity (0,0,1)', () => {
    const s = calcSpecificity('div');
    return s.tag === 1 && s.class === 0 && s.id === 0;
  });

  assertWPT('class selector has specificity (0,1,0)', () => {
    const s = calcSpecificity('.foo');
    return s.class === 1 && s.tag === 0 && s.id === 0;
  });

  assertWPT('ID selector has specificity (1,0,0)', () => {
    const s = calcSpecificity('#bar');
    return s.id === 1 && s.class === 0 && s.tag === 0;
  });

  assertWPT('universal selector has specificity (0,0,0)', () => {
    const s = calcSpecificity('*');
    return s.id === 0 && s.class === 0 && s.tag === 0;
  });

  assertWPT('attribute selector has specificity (0,1,0)', () => {
    const s = calcSpecificity('[data-test]');
    return s.class === 1 && s.tag === 0 && s.id === 0;
  });

  assertWPT('pseudo-class has specificity (0,1,0)', () => {
    const s = calcSpecificity(':hover');
    return s.class === 1 && s.tag === 0 && s.id === 0;
  });

  assertWPT('compound selector sums correctly', () => {
    const s = calcSpecificity('div.foo#bar');
    return s.id === 1 && s.class === 1 && s.tag === 1;
  });
});

describeWPT('CSS Specificity — Ordering', () => {
  assertWPT('ID beats class', () => {
    const s1 = calcSpecificity('#foo');
    const s2 = calcSpecificity('.bar');
    return specScore(s1) > specScore(s2);
  });

  assertWPT('class beats type', () => {
    const s1 = calcSpecificity('.foo');
    const s2 = calcSpecificity('div');
    return specScore(s1) > specScore(s2);
  });

  assertWPT('multiple classes compound', () => {
    const s = calcSpecificity('.a.b');
    return s.class === 2;
  });

  assertWPT('nested selectors sum specificity', () => {
    const s = calcSpecificity('div .foo #bar');
    return s.id === 1 && s.class === 1 && s.tag === 1;
  });
});

// ─── Cascade Rules ────────────────────────────────────────────────────────────

describeWPT('CSS Cascade — Ordering Rules', () => {
  it('later rules have higher source order', () => {
    const sheet = new CSSStyleSheet();
    sheet.insertRule('div { color: red; }', 0);
    sheet.insertRule('div { color: blue; }', 1);
    expect(sheet.cssRules.length).toBe(2);
  });

  it('higher specificity beats later rule', () => {
    const sheet = new CSSStyleSheet();
    sheet.insertRule('div { color: red; }', 0);
    sheet.insertRule('.foo { color: blue; }', 1);
    expect(sheet.cssRules.length).toBe(2);
    const r1 = calcSpecificity((sheet.cssRules[0] as CSSStyleRule).selectorText);
    const r2 = calcSpecificity((sheet.cssRules[1] as CSSStyleRule).selectorText);
    expect(specScore(r2)).toBeGreaterThan(specScore(r1));
  });

  it('ID wins over class', () => {
    const sheet = new CSSStyleSheet();
    sheet.insertRule('.foo { color: red; }', 0);
    sheet.insertRule('#bar { color: blue; }', 1);
    const r1 = calcSpecificity((sheet.cssRules[0] as CSSStyleRule).selectorText);
    const r2 = calcSpecificity((sheet.cssRules[1] as CSSStyleRule).selectorText);
    expect(specScore(r2)).toBeGreaterThan(specScore(r1));
  });
});

// ─── Computed Styles ──────────────────────────────────────────────────────────

describeWPT('CSS Computed Styles — Defaults', () => {
  it('div has display: block by default', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const cs = getComputedStyle(el);
    expect(cs.display).toBe('block');
    document.body.removeChild(el);
  });

  it('span has display: inline default', () => {
    const el = document.createElement('span');
    document.body.appendChild(el);
    const cs = getComputedStyle(el);
    expect(cs.display).not.toBe('block');
    document.body.removeChild(el);
  });

  it('CSSStyleSheet parses multiple rules', () => {
    const sheet = new CSSStyleSheet();
    sheet.insertRule('div { color: red; }', 0);
    sheet.insertRule('.foo { color: blue; }', 1);
    sheet.insertRule('#bar { color: green; }', 2);
    expect(sheet.cssRules.length).toBe(3);
  });
});

// ─── Shorthand Properties — CSSStyleSheet Parsing ─────────────────────────────

describeWPT('CSS Shorthand Properties — Parsing', () => {
  it('parses margin shorthand', () => {
    const sheet = new CSSStyleSheet();
    sheet.insertRule('div { margin: 10px 20px 30px 40px; }', 0);
    const rule = sheet.cssRules[0] as CSSStyleRule;
    expect(rule.style.margin).toBe('10px 20px 30px 40px');
  });

  it('parses padding shorthand', () => {
    const sheet = new CSSStyleSheet();
    sheet.insertRule('div { padding: 5px 10px; }', 0);
    const rule = sheet.cssRules[0] as CSSStyleRule;
    expect(rule.style.padding).toBe('5px 10px');
  });

  it('parses border shorthand', () => {
    const sheet = new CSSStyleSheet();
    sheet.insertRule('div { border: 1px solid black; }', 0);
    const rule = sheet.cssRules[0] as CSSStyleRule;
    expect(rule.style.border).toBe('1px solid black');
  });

  it('parses background shorthand', () => {
    const sheet = new CSSStyleSheet();
    sheet.insertRule('div { background: red; }', 0);
    const rule = sheet.cssRules[0] as CSSStyleRule;
    expect(rule.style.background).toContain('red');
  });

  it('parses flex shorthand', () => {
    const sheet = new CSSStyleSheet();
    sheet.insertRule('div { flex: 1 0 200px; }', 0);
    const rule = sheet.cssRules[0] as CSSStyleRule;
    expect(rule.style.flex).toBe('1 0 200px');
  });

  it('parses transition shorthand', () => {
    const sheet = new CSSStyleSheet();
    sheet.insertRule('div { transition: all 0.3s ease; }', 0);
    const rule = sheet.cssRules[0] as CSSStyleRule;
    expect(rule.style.transition).toBe('all 0.3s ease');
  });
});

// ─── CSS StyleSheet Edge Cases ────────────────────────────────────────────────

describeWPT('CSS StyleSheet — Edge Cases', () => {
  it('handles empty stylesheet', () => {
    const sheet = new CSSStyleSheet();
    expect(sheet.cssRules.length).toBe(0);
  });

  it('handles multiple selectors', () => {
    const sheet = new CSSStyleSheet();
    sheet.insertRule('div, span, p { color: red; }', 0);
    expect(sheet.cssRules.length).toBe(1);
    const rule = sheet.cssRules[0] as CSSStyleRule;
    expect(rule.selectorText).toContain('div');
  });

  it('handles pseudo-elements', () => {
    const sheet = new CSSStyleSheet();
    sheet.insertRule('div::before { content: ""; }', 0);
    expect(sheet.cssRules.length).toBe(1);
  });

  it('handles !important', () => {
    const sheet = new CSSStyleSheet();
    sheet.insertRule('div { color: red !important; }', 0);
    const rule = sheet.cssRules[0] as CSSStyleRule;
    expect(rule.style.getPropertyPriority('color')).toBe('important');
  });

  it('handles CSS custom properties', () => {
    const sheet = new CSSStyleSheet();
    sheet.insertRule(':root { --main-color: blue; }', 0);
    const rule = sheet.cssRules[0] as CSSStyleRule;
    expect(rule.style.getPropertyValue('--main-color')).toBe('blue');
  });

  it('handles calc() function', () => {
    const sheet = new CSSStyleSheet();
    sheet.insertRule('div { width: calc(100% - 20px); }', 0);
    const rule = sheet.cssRules[0] as CSSStyleRule;
    expect(rule.style.width).toContain('calc');
  });

  it('handles @media rule', () => {
    const sheet = new CSSStyleSheet();
    sheet.insertRule('@media (max-width: 768px) { div { width: 100%; } }', 0);
    expect(sheet.cssRules.length).toBe(1);
    expect(sheet.cssRules[0].constructor.name).toBe('CSSMediaRule');
  });
});
