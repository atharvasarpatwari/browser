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

import { CssParser as Css5Parser, computeSelectorSpecificity, parseMediaQueries } from './css5/parser';
import { matchesSelector, querySelector as css5QuerySelector, querySelectorAll as css5QuerySelectorAll } from './css5/selector';
import type { SelectableElement } from './css5/selector';
import { computeComputedStyles, evaluateSupportsCondition, expandShorthands } from './css5/cascade';
import type { StyleableElement } from './css5/cascade';
import type { CssStylesheet as Css5Stylesheet, CssRule as Css5Rule, CssSelector, CssSpecificity as Css5Specificity, CssCompoundSelector, CssMediaQuery } from './css5/types';

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY INTERFACES (backward compatible)
// ─────────────────────────────────────────────────────────────────────────────

interface CssRule {
  readonly selector: string;
  readonly specificity: CssSpecificity;
  readonly declarations: ReadonlyMap<string, string>;
  readonly source: 'inline' | 'style-tag' | 'external';
  readonly sourceUrl: string | null;
  /**
   * Present only for @keyframes rules (selector === ''). Lets the legacy
   * CssRule[] pipe carry keyframes through to the CSS5 stylesheet rebuild so
   * CSS-driven animations resolve their keyframes at runtime.
   */
  readonly keyframes?: { readonly name: string; readonly frames: readonly CssKeyframeDecl[] };
  /**
   * The @media query lists this rule sits inside, outermost first (all must match).
   * Without it the legacy pipe dropped every @media block, so responsive styles never applied.
   */
  readonly media?: readonly (readonly CssMediaQuery[])[];
  /** Properties declared `!important`. The map above holds values only, so importance was lost. */
  readonly important?: ReadonlySet<string>;
  /** The cascade layer the rule sits in (`a.b` when nested); absent when unlayered. */
  readonly layer?: string;
  /** On a `__layer_order__` marker: the names an `@layer a, b;` statement declares, in order. */
  readonly layerNames?: readonly string[];
}

interface CssKeyframeDecl {
  readonly selectors: readonly string[];
  readonly declarations: ReadonlyMap<string, string>;
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
        const media = link.attributes.get('media')?.trim();
        if (href) {
          allRules.push({
            selector: '__external__',
            specificity: { id: 0, class: 0, tag: 0 },
            declarations: new Map(),
            source: 'external',
            sourceUrl: href,
            // <link media="print"> etc.: the loader applies the sheet's rules only where this matches
            ...(media && media.toLowerCase() !== 'all' ? { media: [parseMediaQueries(media)] } : {}),
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
      if (rule.keyframes) continue;

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

  private convertRule(
    rule: Css5Rule,
    order: number,
    sourceUrl: string | null,
    media: readonly (readonly CssMediaQuery[])[] = [],
    layer?: string,
  ): CssRule[] {
    if (rule.type === 'media') {
      return rule.rules.flatMap((inner) => this.convertRule(inner, order, sourceUrl, [...media, rule.mediaQueries], layer));
    }
    // @supports is static (it doesn't depend on the viewport), so it's settled here.
    if (rule.type === 'supports') {
      return evaluateSupportsCondition(rule.condition)
        ? rule.rules.flatMap((inner) => this.convertRule(inner, order, sourceUrl, media, layer))
        : [];
    }
    // Cascade layers travel on each rule (and `@layer a, b;` as a marker) so the cascade can rank
    // them: they were flattened, so layered rules beat unlayered ones by specificity (Tailwind v4's
    // utilities, every layer of a framework vs. the page's own CSS).
    if (rule.type === 'layer') {
      const names = rule.names.length > 0 ? rule.names : [`__anonymous_layer_${++anonymousLayers}`];
      const full = layer ? `${layer}.${names[0]}` : names[0]!;
      return rule.rules.flatMap((inner) => this.convertRule(inner, order, sourceUrl, media, full));
    }
    if (rule.type === 'layer-order') {
      return [{
        selector: '__layer_order__',
        specificity: { id: 0, class: 0, tag: 0 },
        declarations: new Map(),
        source: 'style-tag' as const,
        sourceUrl,
        layerNames: rule.names.map((n) => (layer ? `${layer}.${n}` : n)),
      }];
    }
    if (rule.type === 'keyframes') {
      return [{
        selector: '',
        specificity: { id: 0, class: 0, tag: 0 },
        declarations: new Map(),
        source: 'style-tag' as const,
        sourceUrl,
        keyframes: {
          name: rule.name,
          frames: rule.keyframes.map((kf) => ({
            selectors: kf.selectors,
            declarations: new Map(kf.declarations.map((d) => [d.property, d.value] as const)),
          })),
        },
      }];
    }
    if (rule.type !== 'style') return [];

    return rule.selectors.map((selector) => {
      const selectorStr = selectorToString(selector);
      const declMap = new Map<string, string>();
      const important = new Set<string>();
      for (const decl of rule.declarations) {
        declMap.set(decl.property, decl.value);
        if (decl.important) important.add(decl.property);
        else important.delete(decl.property);
      }

      return {
        selector: selectorStr,
        specificity: { id: rule.specificity.id, class: rule.specificity.a, tag: rule.specificity.b },
        declarations: declMap,
        source: 'style-tag' as const,
        sourceUrl: rule.sourceUrl ?? sourceUrl,
        ...(media.length > 0 ? { media } : {}),
        ...(important.size > 0 ? { important } : {}),
        ...(layer ? { layer } : {}),
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

let anonymousLayers = 0;

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

/**
 * A class or id name as selector text (CSSOM `CSS.escape`): `md:flex` must be written `md\:flex`.
 * Names went out raw, so the re-parsed selector read `.md` plus a pseudo-class `:flex`.
 */
function escapeIdent(name: string): string {
  let out = '';
  for (let i = 0; i < name.length; i++) {
    const ch = name[i]!;
    const code = ch.charCodeAt(0);
    if (/[0-9]/.test(ch) && (i === 0 || (i === 1 && name[0] === '-'))) out += `\\${code.toString(16)} `;
    else if (/[a-zA-Z0-9_-]/.test(ch) || code >= 0x80) out += ch;
    else out += `\\${ch}`;
  }
  return out;
}

function compoundToString(sel: CssCompoundSelector): string {
  let result = '';

  if (sel.tagName) {
    result += sel.tagName;
  } else if (sel.id || sel.classes.length > 0 || sel.attributes.length > 0 || sel.pseudoClasses.length > 0) {
    result += '*';
  }

  if (sel.id) result += `#${escapeIdent(sel.id)}`;
  for (const cls of sel.classes) result += `.${escapeIdent(cls)}`;

  for (const attr of sel.attributes) {
    if (attr.operator) {
      // The operator already ends in "=": this wrote [data-theme=="dark"], which never matched,
      // so every [attr="value"] rule on every page was dropped (httpforever's dark theme).
      const val = `"${(attr.value ?? '').replace(/[\\"]/g, '\\$&')}"`;
      result += `[${attr.name}${attr.operator}${val}${attr.caseInsensitive ? ' i' : ''}]`;
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
      const inner = pc.selectors.map((s: CssSelector, i: number) => {
        const comb = pc.relative?.[i] ?? ' ';
        return (comb === ' ' ? '' : `${comb} `) + selectorToString(s);
      }).join(', ');
      result += `:has(${inner})`;
    } else if (pc.type === 'structural') {
      result += `:${pc.name}`;
      if (pc.value) result += `(${pc.value})`;
    } else if (pc.type === 'where') {
      const inner = pc.selectors.map((s: CssSelector) => selectorToString(s)).join(', ');
      result += `:where(${inner})`;
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
