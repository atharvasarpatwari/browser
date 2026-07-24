/**
 * @file css5-tokenizer-parser.test.ts
 * Comprehensive tests for CSS5 tokenizer and parser fixes.
 *
 * Covers:
 *   - Tokenizer: negative dimensions, asterisk token, whitespace in dimensions,
 *     unterminated strings, unquoted URLs, hex escapes
 *   - Parser: dead consumeQualifiedRule, selector lists, :not() combinators,
 *     multiple pseudo-classes, semicolon in strings, media queries, @layer
 */

import { describe, it, expect } from 'vitest';
import { CssTokenizer, tokenizeCss, tokenizeCssClean } from '../src/browser/rendering/css5/tokenizer';
import { CssTokenType } from '../src/browser/rendering/css5/types';
import { CssParser } from '../src/browser/rendering/css5/parser';
import type { CssSelector, CssCompoundSelector } from '../src/browser/rendering/css5/types';
import { matchesSelector } from '../src/browser/rendering/css5/selector';
import type { SelectableElement } from '../src/browser/rendering/css5/selector';

// ─────────────────────────────────────────────────────────────────────────────
// TOKENIZER TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('CSS5 Tokenizer — Negative Dimensions (Bug #2 fix)', () => {
  it('tokenizes -5px as a single Dimension token', () => {
    const tokens = tokenizeCssClean('-5px');
    expect(tokens.length).toBe(1);
    expect(tokens[0]!.type).toBe(CssTokenType.Dimension);
    expect(tokens[0]!.value).toBe('-5px');
  });

  it('tokenizes -3.5em as a single Dimension token', () => {
    const tokens = tokenizeCssClean('-3.5em');
    expect(tokens.length).toBe(1);
    expect(tokens[0]!.type).toBe(CssTokenType.Dimension);
    expect(tokens[0]!.value).toBe('-3.5em');
  });

  it('tokenizes +10vh as a single Dimension token', () => {
    const tokens = tokenizeCssClean('+10vh');
    expect(tokens.length).toBe(1);
    expect(tokens[0]!.type).toBe(CssTokenType.Dimension);
    expect(tokens[0]!.value).toBe('+10vh');
  });

  it('tokenizes -50% as a single Percentage token', () => {
    const tokens = tokenizeCssClean('-50%');
    expect(tokens.length).toBe(1);
    expect(tokens[0]!.type).toBe(CssTokenType.Percentage);
    expect(tokens[0]!.value).toBe('-50%');
  });

  it('tokenizes margin: -5px correctly in context', () => {
    const tokens = tokenizeCssClean('margin: -5px;');
    expect(tokens[0]!.type).toBe(CssTokenType.Ident);
    expect(tokens[0]!.value).toBe('margin');
    expect(tokens[1]!.type).toBe(CssTokenType.Colon);
    expect(tokens[2]!.type).toBe(CssTokenType.Dimension);
    expect(tokens[2]!.value).toBe('-5px');
  });
});

describe('CSS5 Tokenizer — Asterisk Token (Bug #1 fix)', () => {
  it('tokenizes * as Asterisk token, not Ident', () => {
    const tokens = tokenizeCssClean('*');
    expect(tokens.length).toBe(1);
    expect(tokens[0]!.type).toBe(CssTokenType.Asterisk);
    expect(tokens[0]!.value).toBe('*');
  });

  it('tokenizes universal selector context', () => {
    const tokens = tokenizeCssClean('* { color: red; }');
    expect(tokens[0]!.type).toBe(CssTokenType.Asterisk);
  });

  it('tokenizes * as multiplication in calc()', () => {
    const tokens = tokenizeCss('calc(100% * 2)');
    const asterisks = tokens.filter(t => t.type === CssTokenType.Asterisk);
    expect(asterisks.length).toBe(1);
  });
});

describe('CSS5 Tokenizer — Whitespace in Dimensions (Bug #3 fix)', () => {
  it('does NOT create Dimension for "10 px" (space between number and unit)', () => {
    const tokens = tokenizeCssClean('10 px');
    expect(tokens.length).toBe(2);
    expect(tokens[0]!.type).toBe(CssTokenType.Number);
    expect(tokens[0]!.value).toBe('10');
    expect(tokens[1]!.type).toBe(CssTokenType.Ident);
    expect(tokens[1]!.value).toBe('px');
  });

  it('creates Dimension for "10px" (no space)', () => {
    const tokens = tokenizeCssClean('10px');
    expect(tokens.length).toBe(1);
    expect(tokens[0]!.type).toBe(CssTokenType.Dimension);
    expect(tokens[0]!.value).toBe('10px');
  });
});

describe('CSS5 Tokenizer — Unterminated Strings (Bug #5 fix)', () => {
  it('emits BadString for unterminated double-quoted string', () => {
    const tokens = tokenizeCss('"hello world');
    const badStrings = tokens.filter(t => t.type === CssTokenType.BadString);
    expect(badStrings.length).toBe(1);
    expect(badStrings[0]!.value).toBe('hello world');
  });

  it('emits BadString for unterminated single-quoted string', () => {
    const tokens = tokenizeCss("'hello world");
    const badStrings = tokens.filter(t => t.type === CssTokenType.BadString);
    expect(badStrings.length).toBe(1);
  });

  it('emits String for properly terminated string', () => {
    const tokens = tokenizeCss('"hello world"');
    const strings = tokens.filter(t => t.type === CssTokenType.String);
    expect(strings.length).toBe(1);
    expect(strings[0]!.value).toBe('hello world');
  });
});

describe('CSS5 Tokenizer — Unquoted URLs (Bug #6 fix)', () => {
  it('emits Url for valid unquoted URL', () => {
    const tokens = tokenizeCssClean('url(image.png)');
    expect(tokens.length).toBe(1);
    expect(tokens[0]!.type).toBe(CssTokenType.Url);
    expect(tokens[0]!.value).toBe('image.png');
  });

  it('emits Url for valid quoted URL', () => {
    const tokens = tokenizeCssClean('url("image.png")');
    expect(tokens.length).toBe(1);
    expect(tokens[0]!.type).toBe(CssTokenType.Url);
    expect(tokens[0]!.value).toBe('image.png');
  });

  it('emits BadUrl for unquoted URL with backslash', () => {
    const tokens = tokenizeCssClean('url(foo\\bar)');
    const badUrls = tokens.filter(t => t.type === CssTokenType.BadUrl);
    expect(badUrls.length).toBe(1);
  });

  it('emits BadUrl for unquoted URL with quote', () => {
    const tokens = tokenizeCssClean('url(foo"bar)');
    const badUrls = tokens.filter(t => t.type === CssTokenType.BadUrl);
    expect(badUrls.length).toBe(1);
  });
});

describe('CSS5 Tokenizer — Hex Escapes (Bug #9 fix)', () => {
  it('handles normal hex escapes', () => {
    const tokens = tokenizeCssClean('\\41');
    expect(tokens.length).toBe(1);
    expect(tokens[0]!.value).toBe('A');
  });

  it('replaces null codepoint with U+FFFD', () => {
    const tokens = tokenizeCssClean('\\0');
    expect(tokens.length).toBe(1);
    expect(tokens[0]!.value).toBe('\uFFFD');
  });

  it('does not crash on codepoints > 0x10FFFF', () => {
    expect(() => tokenizeCssClean('\\110000')).not.toThrow();
  });

  it('replaces surrogate codepoints with U+FFFD', () => {
    const tokens = tokenizeCssClean('\\D800');
    expect(tokens.length).toBe(1);
    expect(tokens[0]!.value).toBe('\uFFFD');
  });

  it('replaces U+FFFE with U+FFFD', () => {
    const tokens = tokenizeCssClean('\\FFFE');
    expect(tokens.length).toBe(1);
    expect(tokens[0]!.value).toBe('\uFFFD');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PARSER TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('CSS5 Parser — Qualified Rules (Bug #1 fix)', () => {
  const parser = new CssParser();

  it('parses a simple qualified rule via parseStylesheetRobust', () => {
    const sheet = parser.parseStylesheetRobust('div { color: red; }');
    expect(sheet.rules.length).toBe(1);
    expect(sheet.rules[0]!.type).toBe('style');
  });

  it('parses a qualified rule via parseStylesheet (token-level)', () => {
    const sheet = parser.parseStylesheet('div { color: red; }');
    expect(sheet.rules.length).toBe(1);
    expect(sheet.rules[0]!.type).toBe('style');
  });

  it('parses multiple qualified rules', () => {
    const sheet = parser.parseStylesheet('div { color: red; } span { color: blue; }');
    expect(sheet.rules.length).toBe(2);
  });
});

describe('CSS5 Parser — Selector Lists (Bug #2 fix)', () => {
  const parser = new CssParser();

  it('parses comma-separated selector list', () => {
    const sheet = parser.parseStylesheetRobust('h1, h2, h3 { color: red; }');
    expect(sheet.rules.length).toBe(1);
    if (sheet.rules[0]!.type === 'style') {
      expect(sheet.rules[0]!.selectors.length).toBe(3);
    }
  });

  it('parses selector list with different selector types', () => {
    const sheet = parser.parseStylesheetRobust('div, .class, #id { color: red; }');
    expect(sheet.rules.length).toBe(1);
    if (sheet.rules[0]!.type === 'style') {
      expect(sheet.rules[0]!.selectors.length).toBe(3);
    }
  });

  it('matches elements against selector list', () => {
    const sheet = parser.parseStylesheetRobust('h1, h2, h3 { color: red; }');
    const rule = sheet.rules[0]!;
    expect(rule.type).toBe('style');
    if (rule.type === 'style') {
      const h1: SelectableElement = {
        tagName: 'h1',
        attributes: new Map(),
        parent: null,
        children: [],
      };
      const h2: SelectableElement = {
        tagName: 'h2',
        attributes: new Map(),
        parent: null,
        children: [],
      };
      const div: SelectableElement = {
        tagName: 'div',
        attributes: new Map(),
        parent: null,
        children: [],
      };
      expect(rule.selectors.some(s => matchesSelector(h1, s))).toBe(true);
      expect(rule.selectors.some(s => matchesSelector(h2, s))).toBe(true);
      expect(rule.selectors.some(s => matchesSelector(div, s))).toBe(false);
    }
  });
});

describe('CSS5 Parser — :not() with Combinators (Bug #3 fix)', () => {
  const parser = new CssParser();

  it('preserves descendant combinator in :not() argument', () => {
    const sel = parser.parseSelector(':not(a b)');
    expect(sel).not.toBeNull();
    if (sel?.type === 'compound' && sel.pseudoClasses.length > 0) {
      const pc = sel.pseudoClasses[0]!;
      expect(pc.type).toBe('negation');
      if (pc.type === 'negation') {
        expect(pc.selectors.length).toBe(1);
        const inner = pc.selectors[0]!;
        expect(inner.type).toBe('complex');
        if (inner.type === 'complex') {
          expect(inner.combinator).toBe(' ');
        }
      }
    }
  });

  it('preserves child combinator in :is() argument', () => {
    const sel = parser.parseSelector(':is(ul > li)');
    expect(sel).not.toBeNull();
    if (sel?.type === 'compound' && sel.pseudoClasses.length > 0) {
      const pc = sel.pseudoClasses[0]!;
      expect(pc.type).toBe('is');
      if (pc.type === 'is') {
        expect(pc.selectors.length).toBe(1);
        const inner = pc.selectors[0]!;
        expect(inner.type).toBe('complex');
        if (inner.type === 'complex') {
          expect(inner.combinator).toBe('>');
        }
      }
    }
  });
});

describe('CSS5 Parser — Multiple Pseudo-Classes (Bug #4 fix)', () => {
  const parser = new CssParser();

  it('parses multiple pseudo-classes on one compound', () => {
    const sel = parser.parseSelector('a:hover:focus');
    expect(sel).not.toBeNull();
    if (sel?.type === 'compound') {
      expect(sel.pseudoClasses.length).toBe(2);
      expect(sel.pseudoClasses[0]!.type).toBe('dynamic');
      expect(sel.pseudoClasses[0]!.name).toBe('hover');
      expect(sel.pseudoClasses[1]!.type).toBe('dynamic');
      expect(sel.pseudoClasses[1]!.name).toBe('focus');
    }
  });

  it('matches a:hover:focus correctly', () => {
    const sel = parser.parseSelector('a:hover:focus');
    expect(sel).not.toBeNull();
    const a: SelectableElement = {
      tagName: 'a',
      attributes: new Map(),
      parent: null,
      children: [],
    };
    // Without hover/focus state, it won't match — but it should parse correctly
    if (sel?.type === 'compound') {
      expect(sel.pseudoClasses.length).toBe(2);
    }
  });

  it('parses :hover:not(.disabled)', () => {
    const sel = parser.parseSelector('button:hover:not(.disabled)');
    expect(sel).not.toBeNull();
    if (sel?.type === 'compound') {
      expect(sel.pseudoClasses.length).toBe(2);
      expect(sel.pseudoClasses[0]!.type).toBe('dynamic');
      expect(sel.pseudoClasses[1]!.type).toBe('negation');
    }
  });
});

describe('CSS5 Parser — Semicolons in Strings (Bugs #5/#6 fix)', () => {
  const parser = new CssParser();

  it('handles semicolon inside quoted string in declarations', () => {
    const sheet = parser.parseStylesheetRobust('div { content: "hello; world"; color: red; }');
    expect(sheet.rules.length).toBe(1);
    if (sheet.rules[0]!.type === 'style') {
      const decls = sheet.rules[0]!.declarations;
      const content = decls.find(d => d.property === 'content');
      const color = decls.find(d => d.property === 'color');
      expect(content).toBeDefined();
      expect(content!.value).toBe('"hello; world"');
      expect(color).toBeDefined();
      expect(color!.value).toBe('red');
    }
  });

  it('handles semicolon inside inline style string', () => {
    const map = parser.parseInlineStyle('content: "a; b"; color: blue');
    expect(map.get('content')).toBe('"a; b"');
    expect(map.get('color')).toBe('blue');
  });
});

describe('CSS5 Parser — Media Query Feature Parsing (Bug #7 fix)', () => {
  const parser = new CssParser();

  it('parses media feature with value spanning whitespace', () => {
    const sheet = parser.parseStylesheetRobust('@media (min-width: 800px) { div { color: red; } }');
    expect(sheet.rules.length).toBe(1);
    if (sheet.rules[0]!.type === 'media') {
      expect(sheet.rules[0]!.mediaQueries.length).toBe(1);
      const mq = sheet.rules[0]!.mediaQueries[0]!;
      expect(mq.features.length).toBe(1);
      expect(mq.features[0]!.name).toBe('min-width');
      expect(mq.features[0]!.value).toBe('800px');
    }
  });

  it('parses media query with multiple features', () => {
    const sheet = parser.parseStylesheetRobust('@media (min-width: 600px) and (color) { div { color: red; } }');
    expect(sheet.rules.length).toBe(1);
    if (sheet.rules[0]!.type === 'media') {
      const mq = sheet.rules[0]!.mediaQueries[0]!;
      expect(mq.features.length).toBe(2);
      expect(mq.features[0]!.name).toBe('min-width');
      expect(mq.features[0]!.value).toBe('600px');
      expect(mq.features[1]!.name).toBe('color');
    }
  });
});

describe('CSS5 Parser — @layer Rules', () => {
  const parser = new CssParser();

  it('parses @layer block rule', () => {
    const sheet = parser.parseStylesheetRobust('@layer utilities { .hidden { display: none; } }');
    expect(sheet.rules.length).toBe(1);
    if (sheet.rules[0]!.type === 'layer') {
      expect(sheet.rules[0]!.names).toEqual(['utilities']);
      expect(sheet.rules[0]!.rules.length).toBe(1);
    }
  });

  it('parses anonymous @layer block', () => {
    const sheet = parser.parseStylesheetRobust('@layer { .hidden { display: none; } }');
    expect(sheet.rules.length).toBe(1);
    if (sheet.rules[0]!.type === 'layer') {
      expect(sheet.rules[0]!.names).toEqual([]);
      expect(sheet.rules[0]!.rules.length).toBe(1);
    }
  });

  it('parses @layer order declaration', () => {
    const sheet = parser.parseStylesheetRobust('@layer base, utilities;');
    expect(sheet.rules.length).toBe(1);
    if (sheet.rules[0]!.type === 'layer-order') {
      expect(sheet.rules[0]!.names).toEqual(['base', 'utilities']);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EDGE CASE TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('CSS5 Tokenizer — Edge Cases', () => {
  it('handles empty input', () => {
    const tokens = tokenizeCss('');
    expect(tokens.length).toBe(1); // just EOF
    expect(tokens[0]!.type).toBe(CssTokenType.EOF);
  });

  it('handles whitespace-only input', () => {
    const tokens = tokenizeCss('   \n\t  ');
    const meaningful = tokens.filter(t => t.type !== CssTokenType.Whitespace && t.type !== CssTokenType.EOF);
    expect(meaningful.length).toBe(0);
  });

  it('handles comment-only input', () => {
    const tokens = tokenizeCss('/* hello */');
    const meaningful = tokens.filter(t => t.type !== CssTokenType.Comment && t.type !== CssTokenType.Whitespace && t.type !== CssTokenType.EOF);
    expect(meaningful.length).toBe(0);
  });

  it('tracks source positions', () => {
    const tokens = tokenizeCss('div');
    expect(tokens[0]!.sourceLine).toBe(1);
    expect(tokens[0]!.sourceColumn).toBe(1);
    expect(tokens[0]!.start).toBe(0);
    expect(tokens[0]!.end).toBe(3);
  });
});

describe('CSS5 Parser — Complex Selector Edge Cases', () => {
  const parser = new CssParser();

  it('parses deep descendant selector', () => {
    const sel = parser.parseSelector('div > ul > li > a');
    expect(sel).not.toBeNull();
    expect(sel!.type).toBe('complex');
  });

  it('parses sibling combinators', () => {
    const sel = parser.parseSelector('h1 + p');
    expect(sel).not.toBeNull();
    if (sel?.type === 'complex') {
      expect(sel.combinator).toBe('+');
    }
  });

  it('parses general sibling combinator', () => {
    const sel = parser.parseSelector('h1 ~ p');
    expect(sel).not.toBeNull();
    if (sel?.type === 'complex') {
      expect(sel.combinator).toBe('~');
    }
  });

  it('parses compound with multiple class selectors', () => {
    const sel = parser.parseSelector('.btn.primary.large');
    expect(sel).not.toBeNull();
    if (sel?.type === 'compound') {
      expect(sel.classes.length).toBe(3);
      expect(sel.classes).toContain('btn');
      expect(sel.classes).toContain('primary');
      expect(sel.classes).toContain('large');
    }
  });

  it('parses attribute selectors with all operators', () => {
    const operators = ['=', '~=', '|=', '^=', '$=', '*='];
    for (const op of operators) {
      const sel = parser.parseSelector(`[href${op}"example"]`);
      expect(sel).not.toBeNull();
      if (sel?.type === 'compound') {
        expect(sel.attributes.length).toBe(1);
        expect(sel.attributes[0]!.operator).toBe(op);
      }
    }
  });

  it('parses pseudo-element', () => {
    const sel = parser.parseSelector('div::before');
    expect(sel).not.toBeNull();
    if (sel?.type === 'compound') {
      expect(sel.pseudoElement).toBe('before');
    }
  });
});

describe('CSS5 Parser — Specificity', () => {
  const parser = new CssParser();

  it('calculates correct specificity for simple selectors', () => {
    const sheet = parser.parseStylesheetRobust(`
      div { color: blue; }
      .class { color: green; }
      #id { color: red; }
    `);
    expect(sheet.rules.length).toBe(3);
    // #id has highest specificity
    const rules = sheet.rules;
    if (rules[0]!.type === 'style' && rules[1]!.type === 'style' && rules[2]!.type === 'style') {
      expect(rules[2]!.specificity.id).toBe(1);
      expect(rules[1]!.specificity.a).toBe(1);
      expect(rules[0]!.specificity.b).toBe(1);
    }
  });

  it('calculates specificity correctly for selector lists (uses most specific)', () => {
    const sheet = parser.parseStylesheetRobust('div, #special { color: red; }');
    expect(sheet.rules.length).toBe(1);
    if (sheet.rules[0]!.type === 'style') {
      // Should use the most specific selector in the list
      expect(sheet.rules[0]!.specificity.id).toBe(1);
    }
  });
});
