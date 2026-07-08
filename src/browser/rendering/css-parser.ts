import type { IDisposable } from '../../app/dependency-container';
import type { HtmlDocument, HtmlElement } from './html-parser';
import { getElementsByTagName } from './html-parser';

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

interface ComputedStyleMap {
  readonly [property: string]: string;
}

interface ICssParser extends IDisposable {
  parseStylesheet(css: string, url?: string): CssStylesheet;
  parseInlineStyle(styleAttr: string): ReadonlyMap<string, string>;
  extractStylesFromDocument(doc: HtmlDocument): readonly CssRule[];
  computeStyles(element: HtmlElement, allRules: readonly CssRule[]): ReadonlyMap<string, string>;
  computeStylesForElement(tagName: string, attributes: ReadonlyMap<string, string>, allRules: readonly CssRule[]): ReadonlyMap<string, string>;
}

function specificityWeight(selector: string): CssSpecificity {
  const idCount = (selector.match(/#[a-zA-Z0-9_-]+/g) || []).length;
  const classCount = (selector.match(/\.[a-zA-Z0-9_-]+/g) || []).length;
  const tagCount = (selector.match(/^[a-zA-Z]+|[^.#\s][a-zA-Z]+/g) || []).length;
  return { id: idCount, class: classCount, tag: tagCount };
}

function compareSpecificity(a: CssSpecificity, b: CssSpecificity): number {
  if (a.id !== b.id) return b.id - a.id;
  if (a.class !== b.class) return b.class - a.class;
  return b.tag - a.tag;
}

class CssParser implements ICssParser {
  parseStylesheet(css: string, url?: string): CssStylesheet {
    const rules: CssRule[] = [];
    const blockRe = /([^{]+)\{([^}]*)\}/g;
    let match: RegExpExecArray | null;

    while ((match = blockRe.exec(css)) !== null) {
      const rawSelector = match[1]!.trim();
      const rawDeclarations = match[2]!.trim();

      if (!rawSelector || !rawDeclarations) continue;

      const declarations = this.parseDeclarations(rawDeclarations);

      rules.push({
        selector: rawSelector,
        specificity: specificityWeight(rawSelector),
        declarations,
        source: 'style-tag',
        sourceUrl: url ?? null,
      });
    }

    return { rules, url: url ?? null };
  }

  parseInlineStyle(styleAttr: string): ReadonlyMap<string, string> {
    return this.parseDeclarations(styleAttr);
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
    const matched: CssRule[] = [];
    const id = attributes.get('id') ?? '';
    const classes = (attributes.get('class') ?? '').split(/\s+/).filter(Boolean);

    for (const rule of allRules) {
      let matches = false;
      const sel = rule.selector;

      if (sel === '*' || sel === tagName) matches = true;
      if (id && sel === `#${id}`) matches = true;
      for (const cls of classes) {
        if (sel === `.${cls}`) matches = true;
      }
      if (sel.includes('#') && id) {
        const selId = sel.match(/#([a-zA-Z0-9_-]+)/)?.[1];
        if (selId === id) matches = true;
      }
      for (const cls of classes) {
        if (sel.includes(`.${cls}`)) matches = true;
      }

      if (matches) matched.push(rule);
    }

    matched.sort((a, b) => compareSpecificity(a.specificity, b.specificity));

    const computed = new Map<string, string>();
    for (const rule of matched) {
      for (const [prop, value] of rule.declarations) {
        computed.set(prop, value);
      }
    }

    const inlineStyle = attributes.get('style');
    if (inlineStyle) {
      const inline = this.parseInlineStyle(inlineStyle);
      for (const [prop, value] of inline) {
        computed.set(prop, value);
      }
    }

    this.applyDefaults(tagName, computed);
    return computed;
  }

  private parseDeclarations(raw: string): Map<string, string> {
    const decls = new Map<string, string>();
    const parts = raw.split(';');

    for (const part of parts) {
      const colon = part.indexOf(':');
      if (colon === -1) continue;
      const prop = part.slice(0, colon).trim().toLowerCase();
      const value = part.slice(colon + 1).trim();
      if (prop && value) decls.set(prop, value);
    }

    return decls;
  }

  private applyDefaults(tagName: string, computed: Map<string, string>): void {
    if (!computed.has('display')) {
      const blockTags = new Set(['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'section', 'article', 'nav', 'header', 'footer', 'main', 'aside', 'table', 'form', 'blockquote', 'hr']);
      computed.set('display', blockTags.has(tagName) ? 'block' : 'inline');
    }
    if (!computed.has('color')) computed.set('color', '#000000');
    if (!computed.has('font-size')) computed.set('font-size', '16px');
    if (!computed.has('font-family')) computed.set('font-family', 'sans-serif');
  }

  dispose(): void {}
}

export { CssParser, compareSpecificity, specificityWeight };
export type { ICssParser, CssRule, CssStylesheet, CssSpecificity };
