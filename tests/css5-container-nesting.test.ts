import { describe, it, expect } from 'vitest';
import { CssParser } from '../src/browser/rendering/css5/parser';
import type { CssRule, CssContainerRule, CssStyleRule } from '../src/browser/rendering/css5/types';
import { computeComputedStyles, type StyleableElement } from '../src/browser/rendering/css5/cascade';
import { isInheritedProperty, getInitialValue, isShorthandProperty, getLonghands, getAllPropertyDefinitions } from '../src/browser/rendering/css5/property-definitions';

function sel(
  tag: string,
  attrs?: Record<string, string>,
  children?: StyleableElement[],
  parent?: StyleableElement | null,
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

// ─────────────────────────────────────────────────────────────────────────────
// @container Queries
// ─────────────────────────────────────────────────────────────────────────────

describe('@container Queries — Parsing', () => {
  it('parses @container rule with size query', () => {
    const css = `@container (min-width: 700px) { .foo { color: red; } }`;
    const parser = new CssParser();
    const stylesheet = parser.parseStylesheetRobust(css);
    expect(stylesheet.rules).toHaveLength(1);
    const rule = stylesheet.rules[0] as CssContainerRule;
    expect(rule.type).toBe('container');
    expect(rule.name).toBe('');
    expect(rule.query).toBe('(min-width: 700px)');
    expect(rule.rules).toHaveLength(1);
    const inner = rule.rules[0] as CssStyleRule;
    expect(inner.type).toBe('style');
    expect(inner.declarations[0]!.property).toBe('color');
    expect(inner.declarations[0]!.value).toBe('red');
  });

  it('parses @container with named container', () => {
    const css = `@container sidebar (min-width: 400px) { .foo { color: blue; } }`;
    const parser = new CssParser();
    const stylesheet = parser.parseStylesheetRobust(css);
    expect(stylesheet.rules).toHaveLength(1);
    const rule = stylesheet.rules[0] as CssContainerRule;
    expect(rule.type).toBe('container');
    expect(rule.name).toBe('sidebar');
    expect(rule.query).toBe('(min-width: 400px)');
  });

  it('parses @container with multiple conditions (and)', () => {
    const css = `@container (min-width: 400px) and (max-width: 800px) { .foo { color: green; } }`;
    const parser = new CssParser();
    const stylesheet = parser.parseStylesheetRobust(css);
    const rule = stylesheet.rules[0] as CssContainerRule;
    expect(rule.query).toBe('(min-width: 400px) and (max-width: 800px)');
  });

  it('parses @container with range syntax', () => {
    const css = `@container (width >= 400px) { .foo { color: red; } }`;
    const parser = new CssParser();
    const stylesheet = parser.parseStylesheetRobust(css);
    const rule = stylesheet.rules[0] as CssContainerRule;
    expect(rule.query).toBe('(width >= 400px)');
  });

  it('parses empty @container rule', () => {
    const css = `@container (min-width: 700px) { }`;
    const parser = new CssParser();
    const stylesheet = parser.parseStylesheetRobust(css);
    const rule = stylesheet.rules[0] as CssContainerRule;
    expect(rule.rules).toHaveLength(0);
  });

  it('parses @container with nested style rules', () => {
    const css = `@container (min-width: 700px) { .card { background: white; } .card h2 { font-size: 2em; } }`;
    const parser = new CssParser();
    const stylesheet = parser.parseStylesheetRobust(css);
    const rule = stylesheet.rules[0] as CssContainerRule;
    expect(rule.rules).toHaveLength(2);
    expect((rule.rules[0] as CssStyleRule).selectors).toHaveLength(1);
    expect((rule.rules[1] as CssStyleRule).selectors).toHaveLength(1);
  });
});

describe('@container Queries — Property Definitions', () => {
  it('defines container-type property', () => {
    expect(isInheritedProperty('container-type')).toBe(false);
    expect(getInitialValue('container-type')).toBe('normal');
  });

  it('defines container-name property', () => {
    expect(isInheritedProperty('container-name')).toBe(false);
    expect(getInitialValue('container-name')).toBe('none');
  });

  it('defines container shorthand', () => {
    expect(isShorthandProperty('container')).toBe(true);
    const longhands = getLonghands('container');
    expect(longhands).toContain('container-type');
    expect(longhands).toContain('container-name');
  });

  it('container property exists in full definitions', () => {
    const defs = getAllPropertyDefinitions();
    expect(defs['container-type']).toBeDefined();
    expect(defs['container-type']!.initialValue).toBe('normal');
    expect(defs['container-name']).toBeDefined();
    expect(defs['container-name']!.initialValue).toBe('none');
    expect(defs['container']).toBeDefined();
  });
});

describe('@container Queries — Cascade Evaluation', () => {
  it('evaluates @container with matching query', () => {
    const css = `@container (min-width: 700px) { .foo { color: red; } }`;
    const parser = new CssParser();
    const stylesheet = parser.parseStylesheetRobust(css);
    const element = sel('div', { class: 'foo' });
    const computed = computeComputedStyles(element, stylesheet, { width: 1920, height: 1080 });
    expect(computed.get('color')).toBe('#ff0000');
  });

  it('skips @container with non-matching query', () => {
    const css = `@container (min-width: 2000px) { .foo { color: red; } }`;
    const parser = new CssParser();
    const stylesheet = parser.parseStylesheetRobust(css);
    const element = sel('div', { class: 'foo' });
    const computed = computeComputedStyles(element, stylesheet, { width: 1920, height: 1080 });
    expect(computed.get('color')).toBe('canvastext');
  });

  it('evaluates @container with range syntax', () => {
    const css = `@container (width > 1000px) { .foo { color: red; } }`;
    const parser = new CssParser();
    const stylesheet = parser.parseStylesheetRobust(css);
    const element = sel('div', { class: 'foo' });
    const computed = computeComputedStyles(element, stylesheet, { width: 1920, height: 1080 });
    expect(computed.get('color')).toBe('#ff0000');
  });

  it('evaluates @container with range syntax — does not match', () => {
    const css = `@container (width > 2000px) { .foo { color: red; } }`;
    const parser = new CssParser();
    const stylesheet = parser.parseStylesheetRobust(css);
    const element = sel('div', { class: 'foo' });
    const computed = computeComputedStyles(element, stylesheet, { width: 1920, height: 1080 });
    expect(computed.get('color')).toBe('canvastext');
  });

  it('evaluates @container with and conditions', () => {
    const css = `@container (min-width: 700px) and (max-width: 2000px) { .foo { color: red; } }`;
    const parser = new CssParser();
    const stylesheet = parser.parseStylesheetRobust(css);
    const element = sel('div', { class: 'foo' });
    const computed = computeComputedStyles(element, stylesheet, { width: 1920, height: 1080 });
    expect(computed.get('color')).toBe('#ff0000');
  });

  it('evaluates @container with and conditions — fails on second', () => {
    const css = `@container (min-width: 700px) and (max-width: 1000px) { .foo { color: red; } }`;
    const parser = new CssParser();
    const stylesheet = parser.parseStylesheetRobust(css);
    const element = sel('div', { class: 'foo' });
    const computed = computeComputedStyles(element, stylesheet, { width: 1920, height: 1080 });
    expect(computed.get('color')).toBe('canvastext');
  });

  it('evaluates @container with not modifier', () => {
    const css = `@container not (min-width: 2000px) { .foo { color: red; } }`;
    const parser = new CssParser();
    const stylesheet = parser.parseStylesheetRobust(css);
    const element = sel('div', { class: 'foo' });
    const computed = computeComputedStyles(element, stylesheet, { width: 1920, height: 1080 });
    expect(computed.get('color')).toBe('#ff0000');
  });

  it('evaluates @container with or conditions', () => {
    const css = `@container (max-width: 1000px) or (min-width: 1500px) { .foo { color: red; } }`;
    const parser = new CssParser();
    const stylesheet = parser.parseStylesheetRobust(css);
    const element = sel('div', { class: 'foo' });
    const computed = computeComputedStyles(element, stylesheet, { width: 1920, height: 1080 });
    expect(computed.get('color')).toBe('#ff0000');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CSS Nesting
// ─────────────────────────────────────────────────────────────────────────────

describe('CSS Nesting — Basic', () => {
  it('flattens simple nested rule (implicit descendant)', () => {
    const css = `.parent { color: red; .child { color: blue; } }`;
    const parser = new CssParser();
    const stylesheet = parser.parseStylesheetRobust(css);
    expect(stylesheet.rules).toHaveLength(2);
    const rule1 = stylesheet.rules[0] as CssStyleRule;
    const rule2 = stylesheet.rules[1] as CssStyleRule;
    expect(rule1.type).toBe('style');
    expect(rule2.type).toBe('style');
  });

  it('applies nested rule styles to child elements', () => {
    const css = `.parent { color: red; .child { color: blue; } }`;
    const parser = new CssParser();
    const stylesheet = parser.parseStylesheetRobust(css);
    const parent = sel('div', { class: 'parent' });
    const child = sel('span', { class: 'child' }, [], parent);
    parent.children = [child];

    const parentComputed = computeComputedStyles(parent, stylesheet, { width: 1920, height: 1080 });
    expect(parentComputed.get('color')).toBe('#ff0000');

    const childComputed = computeComputedStyles(child, stylesheet, { width: 1920, height: 1080 }, parentComputed);
    expect(childComputed.get('color')).toBe('#0000ff');
  });

  it('handles & nesting selector', () => {
    const css = `.btn { color: black; &.active { color: green; } }`;
    const parser = new CssParser();
    const stylesheet = parser.parseStylesheetRobust(css);
    expect(stylesheet.rules).toHaveLength(2);
  });

  it('applies & nesting selector matching', () => {
    const css = `.btn { color: black; &.active { color: green; } }`;
    const parser = new CssParser();
    const stylesheet = parser.parseStylesheetRobust(css);
    const btn = sel('button', { class: 'btn active' });
    const computed = computeComputedStyles(btn, stylesheet, { width: 1920, height: 1080 });
    expect(computed.get('color')).toBe('#008000');
  });

  it('handles & with descendant combinator', () => {
    const css = `.card { border: 1px solid gray; & .title { font-size: 1.5em; } }`;
    const parser = new CssParser();
    const stylesheet = parser.parseStylesheetRobust(css);
    expect(stylesheet.rules).toHaveLength(2);
  });

  it('handles deeply nested rules (2 levels)', () => {
    const css = `.a { color: red; .b { color: blue; .c { color: green; } } }`;
    const parser = new CssParser();
    const stylesheet = parser.parseStylesheetRobust(css);
    // .a, .a .b, .a .b .c
    expect(stylesheet.rules.length).toBeGreaterThanOrEqual(3);
  });

  it('applies deeply nested rule styles', () => {
    const css = `.a { color: red; .b { color: blue; .c { color: green; } } }`;
    const parser = new CssParser();
    const stylesheet = parser.parseStylesheetRobust(css);
    const a = sel('div', { class: 'a' });
    const b = sel('div', { class: 'b' }, [], a);
    const c = sel('span', { class: 'c' }, [], b);
    a.children = [b];
    b.children = [c];

    const computedA = computeComputedStyles(a, stylesheet, { width: 1920, height: 1080 });
    expect(computedA.get('color')).toBe('#ff0000');

    const computedB = computeComputedStyles(b, stylesheet, { width: 1920, height: 1080 }, computedA);
    expect(computedB.get('color')).toBe('#0000ff');

    const computedC = computeComputedStyles(c, stylesheet, { width: 1920, height: 1080 }, computedB);
    expect(computedC.get('color')).toBe('#008000');
  });

  it('handles multiple nested rules', () => {
    const css = `.parent { color: red; .child1 { color: blue; } .child2 { color: green; } }`;
    const parser = new CssParser();
    const stylesheet = parser.parseStylesheetRobust(css);
    expect(stylesheet.rules).toHaveLength(3);
  });

  it('handles nested rules with multiple declarations', () => {
    const css = `.parent { color: red; .child { color: blue; font-size: 1.2em; } }`;
    const parser = new CssParser();
    const stylesheet = parser.parseStylesheetRobust(css);
    const parent = sel('div', { class: 'parent' });
    const child = sel('span', { class: 'child' }, [], parent);
    parent.children = [child];

    const computedC = computeComputedStyles(child, stylesheet, { width: 1920, height: 1080 });
    expect(computedC.get('color')).toBe('#0000ff');
    expect(computedC.get('font-size')).toBe('1.2em');
  });

  it('handles multiple & selectors in one rule', () => {
    const css = `.card { &.featured { border: 2px solid gold; } &.disabled { opacity: 0.5; } }`;
    const parser = new CssParser();
    const stylesheet = parser.parseStylesheetRobust(css);
    expect(stylesheet.rules).toHaveLength(2);
  });

  it('handles direct child combinator in nesting', () => {
    const css = `.list { color: black; > .item { color: red; } }`;
    const parser = new CssParser();
    const stylesheet = parser.parseStylesheetRobust(css);
    expect(stylesheet.rules).toHaveLength(2);
    const list = sel('ul', { class: 'list' });
    const item = sel('li', { class: 'item' }, [], list);
    list.children = [item];
    const computed = computeComputedStyles(item, stylesheet, { width: 1920, height: 1080 });
    expect(computed.get('color')).toBe('#ff0000');
  });
});

describe('CSS Nesting — @media Nesting', () => {
  it('handles @media nested inside a rule', () => {
    const css = `.card { color: black; @media (min-width: 768px) { color: red; } }`;
    const parser = new CssParser();
    const stylesheet = parser.parseStylesheetRobust(css);
    expect(stylesheet.rules.length).toBeGreaterThanOrEqual(1);
  });

  it('handles @supports nested inside a rule', () => {
    const css = `.card { color: black; @supports (display: grid) { display: grid; } }`;
    const parser = new CssParser();
    const stylesheet = parser.parseStylesheetRobust(css);
    expect(stylesheet.rules.length).toBeGreaterThanOrEqual(1);
  });
});

describe('CSS Nesting — Pseudo-classes in Nesting', () => {
  it('handles :hover with & nesting selector', () => {
    const css = `.btn { color: black; &:hover { color: blue; } }`;
    const parser = new CssParser();
    const stylesheet = parser.parseStylesheetRobust(css);
    expect(stylesheet.rules).toHaveLength(2);
  });

  it('handles ::before pseudo-element in nesting', () => {
    const css = `.list { color: black; &::before { content: ">"; } }`;
    const parser = new CssParser();
    const stylesheet = parser.parseStylesheetRobust(css);
    expect(stylesheet.rules).toHaveLength(2);
  });
});
