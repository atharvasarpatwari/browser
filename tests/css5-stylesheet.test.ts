import { describe, it, expect } from 'vitest';
import { StyleSheet } from '../src/browser/rendering/css5/stylesheet';
import type { CssRule, CssStyleRule } from '../src/browser/rendering/css5/types';

describe('StyleSheet', () => {
  it('should create empty stylesheet', () => {
    const ss = new StyleSheet('test');
    expect(ss.id).toBe('test');
    expect(ss.length).toBe(0);
    expect(ss.rules).toEqual([]);
  });

  it('should create stylesheet with rules', () => {
    const rules: CssRule[] = [
      { type: 'style', selectors: [], declarations: [], specificity: { id: 0, a: 0, b: 0 }, sourceOrder: 0, sourceUrl: null },
    ];
    const ss = new StyleSheet('test', rules);
    expect(ss.length).toBe(1);
  });

  it('should insert a rule at the end by default', () => {
    const ss = new StyleSheet('test');
    const idx = ss.insertRule('div { color: red }');
    expect(idx).toBe(0);
    expect(ss.length).toBe(1);
    const rule = ss.rules[0] as CssStyleRule;
    expect(rule.type).toBe('style');
  });

  it('should insert a rule at a specific index', () => {
    const ss = new StyleSheet('test');
    ss.insertRule('.a { color: red }');
    ss.insertRule('.b { color: blue }', 0);
    expect(ss.length).toBe(2);
    expect((ss.rules[0] as CssStyleRule).declarations[0].property).toBe('color');
    expect((ss.rules[0] as CssStyleRule).declarations[0].value).toBe('blue');
  });

  it('should clamp insert index to valid range', () => {
    const ss = new StyleSheet('test');
    ss.insertRule('.a { color: red }');
    ss.insertRule('.b { color: blue }', -5);
    expect(ss.length).toBe(2);
    expect((ss.rules[0] as CssStyleRule).declarations[0].value).toBe('blue');
  });

  it('should delete a rule by index', () => {
    const ss = new StyleSheet('test');
    ss.insertRule('.a { color: red }');
    ss.insertRule('.b { color: blue }');
    ss.deleteRule(0);
    expect(ss.length).toBe(1);
    expect((ss.rules[0] as CssStyleRule).declarations[0].value).toBe('blue');
  });

  it('should do nothing when deleting out-of-range index', () => {
    const ss = new StyleSheet('test');
    ss.insertRule('.a { color: red }');
    ss.deleteRule(5);
    expect(ss.length).toBe(1);
    ss.deleteRule(-1);
    expect(ss.length).toBe(1);
  });

  it('should replace a rule by index', () => {
    const ss = new StyleSheet('test');
    ss.insertRule('.a { color: red }');
    const newRule: CssStyleRule = {
      type: 'style', selectors: [], declarations: [{ property: 'background', value: 'blue', important: false }],
      specificity: { id: 0, a: 0, b: 0 }, sourceOrder: 1, sourceUrl: null,
    };
    ss.replaceRule(0, newRule);
    expect(ss.length).toBe(1);
    expect((ss.rules[0] as CssStyleRule).declarations[0].property).toBe('background');
  });

  it('should do nothing when replacing out-of-range index', () => {
    const ss = new StyleSheet('test');
    ss.insertRule('.a { color: red }');
    const newRule: CssStyleRule = {
      type: 'style', selectors: [], declarations: [], specificity: { id: 0, a: 0, b: 0 }, sourceOrder: 1, sourceUrl: null,
    };
    ss.replaceRule(5, newRule);
    expect(ss.length).toBe(1);
  });

  it('should add a rule and return its index', () => {
    const ss = new StyleSheet('test');
    const rule: CssStyleRule = {
      type: 'style', selectors: [], declarations: [], specificity: { id: 0, a: 0, b: 0 }, sourceOrder: 0, sourceUrl: null,
    };
    const idx = ss.addRule(rule);
    expect(idx).toBe(0);
    expect(ss.length).toBe(1);
  });

  it('should parse @-rules from text', () => {
    const ss = new StyleSheet('test');
    ss.insertRule('@import url("style.css")');
    expect(ss.length).toBe(1);
    expect(ss.rules[0].type).toBe('unknown');
  });

  it('should produce a CssStylesheet via toCssStylesheet', () => {
    const ss = new StyleSheet('test', [], 'http://example.com/style.css');
    ss.insertRule('div { color: red }');
    const css = ss.toCssStylesheet();
    expect(css.rules).toHaveLength(1);
    expect(css.url).toBe('http://example.com/style.css');
  });

  it('should clear all rules', () => {
    const ss = new StyleSheet('test');
    ss.insertRule('.a { color: red }');
    ss.insertRule('.b { color: blue }');
    ss.clear();
    expect(ss.length).toBe(0);
  });

  it('should clone with a new id', () => {
    const ss = new StyleSheet('original');
    ss.insertRule('div { color: red }');
    const cloned = ss.clone('clone');
    expect(cloned.id).toBe('clone');
    expect(cloned.length).toBe(1);
    expect(cloned.rules[0]).toEqual(ss.rules[0]);
    // mutations on clone should not affect original
    cloned.insertRule('span { color: blue }');
    expect(cloned.length).toBe(2);
    expect(ss.length).toBe(1);
  });

  it('should respect disabled flag — cssRules returns empty when disabled', () => {
    const ss = new StyleSheet('test');
    ss.insertRule('div { color: red }');
    expect(ss.cssRules).toHaveLength(1);
    ss.disabled = true;
    expect(ss.cssRules).toHaveLength(0);
    ss.disabled = false;
    expect(ss.cssRules).toHaveLength(1);
  });
});
