/**
 * @file css-parser.ts
 * CSS Parser facade — backward-compatible interface wrapping the CSS5 engine.
 *
 * Maintains the same public API (ICssParser, CssRule, CssStylesheet, CssSpecificity)
 * while using the new modular CSS5 engine internally.
 */

import type { IDisposable } from '../../app/dependency-container';
import type { HtmlDocument, HtmlElement } from './html-parser';
import { getElementsByTagName } from './html-parser';

import { CssParser as Css5Parser, computeSelectorSpecificity } from './css5/parser';
import { matchesSelector, querySelector as css5QuerySelector, querySelectorAll as css5QuerySelectorAll } from './css5/selector';
import type { SelectableElement } from './css5/selector';
import { computeComputedStyles, expandShorthands } from './css5/cascade';
import type { StyleableElement } from './css5/cascade';
import type { CssStylesheet as Css5Stylesheet, CssRule as Css5Rule, CssSelector, CssSpecificity as Css5Specificity, CssCompoundSelector } from './css5/types';

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY INTERFACES (backward compatible)
// ─────────────────────────────────────────────────────────────────────────────

interface CssRule {
  readonly selector: string;
  readonly specificity: CssSpecificity;
  readonly declarations: ReadonlyMap<string, string>;
  readonly source: 'inline' | 'style-tag' | 'external';
  readonly sourceUrl: string | null;
}

interface CssSpecificity {
  readonly id: number;
  readonly class: number;
  readonly tag: number;
}

interface CssStylesheet {
  readonly rules: readonly CssRule[];
  readonly url: string | null;
}

interface ICssParser extends IDisposable {
  parseStylesheet(css: string, url?: string): CssStylesheet;
  parseInlineStyle(styleAttr: string): ReadonlyMap<string, string>;
  extractStylesFromDocument(doc: HtmlDocument): readonly CssRule[];
  computeStyles(element: HtmlElement, allRules: readonly CssRule[]): ReadonlyMap<string, string>;
  computeStylesForElement(tagName: string, attributes: ReadonlyMap<string, string>, allRules: readonly CssRule[]): ReadonlyMap<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY FUNCTIONS (backward compatible exports)
// ─────────────────────────────────────────────────────────────────────────────

function specificityWeight(selector: string): CssSpecificity {
  const idCount = (selector.match(/#[a-zA-Z0-9_-]+/g) || []).length;
  const classCount = (selector.match(/\.[a-zA-Z0-9_-]+/g) || []).length;
  // Match tag names: preceded by start/space (not by # . : -), followed by non-letter
  const tagCount = (selector.match(/(?<![\w#.:\\-])[a-zA-Z]+(?![a-zA-Z])/g) || []).length;
  return { id: idCount, class: classCount, tag: tagCount };
}

function compareSpecificity(a: CssSpecificity, b: CssSpecificity): number {
  if (a.id !== b.id) return b.id - a.id;
  if (a.class !== b.class) return b.class - a.class;
  return b.tag - a.tag;
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS5-BACKED PARSER
// ─────────────────────────────────────────────────────────────────────────────

class CssParser implements ICssParser {
  private css5: Css5Parser;

  constructor() {
    this.css5 = new Css5Parser();
  }

  parseStylesheet(css: string, url?: string): CssStylesheet {
    const css5Sheet = this.css5.parseStylesheetRobust(css, url);

    // Convert CSS5 rules to legacy CssRule format
    const rules: CssRule[] = [];
    let order = 0;

    for (const rule of css5Sheet.rules) {
      const converted = this.convertRule(rule, order, url ?? null);
      if (converted) {
        rules.push(...converted);
        order += converted.length;
      }
    }

    return { rules, url: url ?? null };
  }

  parseInlineStyle(styleAttr: string): ReadonlyMap<string, string> {
    return this.css5.parseInlineStyle(styleAttr);
  }

  extractStylesFromDocument(doc: HtmlDocument): readonly CssRule[] {
    const allRules: CssRule[] = [];

    const styleEls = getElementsByTagName(doc, 'style');
    for (const style of styleEls) {
      const text = (style as { rawContent: string }).rawContent || '';
      if (text.trim()) {
        const parsed = this.parseStylesheet(text);
        allRules.push(...parsed.rules);
      }
    }

    const linkEls = getElementsByTagName(doc, 'link');
    for (const link of linkEls) {
      const rel = link.attributes.get('rel')?.toLowerCase();
      if (rel === 'stylesheet') {
        const href = link.attributes.get('href');
        if (href) {
          allRules.push({
            selector: '__external__',
            specificity: { id: 0, class: 0, tag: 0 },
            declarations: new Map(),
            source: 'external',
            sourceUrl: href,
          });
        }
      }
    }

    return allRules;
  }

  computeStyles(element: HtmlElement, allRules: readonly CssRule[]): ReadonlyMap<string, string> {
    return this.computeStylesForElement(element.tagName, element.attributes, allRules);
  }

  computeStylesForElement(
    tagName: string,
    attributes: ReadonlyMap<string, string>,
    allRules: readonly CssRule[],
  ): ReadonlyMap<string, string> {
    // Convert legacy CssRule to CSS5 rule format for matching
    const css5Rules: Css5Rule[] = [];
    let order = 0;

    for (const rule of allRules) {
      if (rule.selector === '__external__') continue;

      // Parse the selector string using CSS5 parser
      const selector = this.css5.parseSelector(rule.selector);
      if (!selector) continue;

      const specificity = computeSelectorSpecificity(selector);
      css5Rules.push({
        type: 'style',
        selectors: [selector],
        declarations: Array.from(rule.declarations.entries()).map(([prop, value]) => ({
          property: prop,
          value,
          important: false,
        })),
        specificity,
        sourceOrder: order++,
        sourceUrl: rule.sourceUrl,
      });
    }

    // Create a temporary stylesheet
    const stylesheet: Css5Stylesheet = { rules: css5Rules, url: null };

    // Create a StyleableElement from the element
    const styleable = this.toStyleableElement(tagName, attributes);

    // Compute styles using the CSS5 cascade
    const computed = computeComputedStyles(styleable, stylesheet);

    return computed;
  }

  /**
   * Get the CSS5 parser for advanced usage.
   */
  getCss5Parser(): Css5Parser {
    return this.css5;
  }

  dispose(): void {}

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  private convertRule(rule: Css5Rule, order: number, sourceUrl: string | null): CssRule[] {
    if (rule.type !== 'style') return [];

    return rule.selectors.map((selector) => {
      const selectorStr = selectorToString(selector);
      const declMap = new Map<string, string>();
      for (const decl of rule.declarations) {
        declMap.set(decl.property, decl.value);
      }

      return {
        selector: selectorStr,
        specificity: { id: rule.specificity.id, class: rule.specificity.a, tag: rule.specificity.b },
        declarations: declMap,
        source: 'style-tag' as const,
        sourceUrl: rule.sourceUrl ?? sourceUrl,
      };
    });
  }

  private toStyleableElement(tagName: string, attributes: ReadonlyMap<string, string>): StyleableElement {
    return {
      tagName,
      attributes,
      parent: null,
      children: [],
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SELECTOR → STRING (for backward compat)
// ─────────────────────────────────────────────────────────────────────────────

function selectorToString(selector: CssSelector): string {
  if (selector.type === 'compound') {
    return compoundToString(selector);
  }

  // Complex selector
  const left = selectorToString(selector.left);
  const right = compoundToString(selector.right);

  switch (selector.combinator) {
    case ' ':  return `${left} ${right}`;
    case '>':  return `${left} > ${right}`;
    case '+':  return `${left} + ${right}`;
    case '~':  return `${left} ~ ${right}`;
    default:   return `${left} ${right}`;
  }
}

function compoundToString(sel: CssCompoundSelector): string {
  let result = '';

  if (sel.tagName) {
    result += sel.tagName;
  } else if (sel.id || sel.classes.length > 0 || sel.attributes.length > 0 || sel.pseudoClasses.length > 0) {
    result += '*';
  }

  if (sel.id) result += `#${sel.id}`;
  for (const cls of sel.classes) result += `.${cls}`;

  for (const attr of sel.attributes) {
    if (attr.operator) {
      const val = attr.value !== null ? `="${attr.value}"` : '';
      result += `[${attr.name}${attr.operator}${val}]`;
    } else {
      result += `[${attr.name}]`;
    }
  }

  for (const pc of sel.pseudoClasses) {
    if (pc.type === 'negation') {
      const inner = pc.selectors.map((s: CssSelector) => selectorToString(s)).join(', ');
      result += `:not(${inner})`;
    } else if (pc.type === 'is' || pc.type === 'any') {
      const inner = pc.selectors.map((s: CssSelector) => selectorToString(s)).join(', ');
      result += `:is(${inner})`;
    } else if (pc.type === 'has') {
      const inner = pc.selectors.map((s: CssSelector) => selectorToString(s)).join(', ');
      result += `:has(${inner})`;
    } else if (pc.type === 'structural') {
      result += `:${pc.name}`;
      if (pc.value) result += `(${pc.value})`;
    } else {
      result += `:${pc.name}`;
    }
  }

  if (sel.pseudoElement) result += `::${sel.pseudoElement}`;

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS (backward compatible)
// ─────────────────────────────────────────────────────────────────────────────

export { CssParser, compareSpecificity, specificityWeight };
export type { ICssParser, CssRule, CssStylesheet, CssSpecificity };

// Also export CSS5 modules for advanced usage
export {
  Css5Parser as Css5Engine,
  computeComputedStyles,
  expandShorthands,
  matchesSelector as css5MatchesSelector,
  css5QuerySelector,
  css5QuerySelectorAll,
};
