import type { CssRule, CssStyleRule, CssStylesheet, CssSpecificity } from './types';

/**
 * A mutable CSSStyleSheet with rule management (add/remove/replace rules).
 *
 * Wraps an immutable CssStylesheet and tracks a user-assigned id for
 * debugging or removal.  Rules are stored in a flat list; insertRule and
 * deleteRule operate by index.
 *
 * §CSSOM: https://drafts.csswg.org/cssom/#the-cssstylesheet-interface
 */
export class StyleSheet {
  readonly id: string;
  readonly url: string | null;
  private _rules: CssRule[];
  private _sourceOrderCounter = 0;
  private _disabled = false;

  constructor(id: string, rules: readonly CssRule[] = [], url: string | null = null) {
    this.id = id;
    this.url = url;
    this._rules = [...rules];
  }

  get disabled(): boolean { return this._disabled; }
  set disabled(v: boolean) { this._disabled = v; }

  get rules(): readonly CssRule[] { return this._rules; }
  get cssRules(): readonly CssRule[] { return this._disabled ? [] : this._rules; }

  get length(): number { return this._rules.length; }

  insertRule(ruleText: string, index: number = this._rules.length): number {
    const rule = this._parseRuleText(ruleText);
    const idx = Math.max(0, Math.min(index, this._rules.length));
    this._rules.splice(idx, 0, rule);
    return idx;
  }

  deleteRule(index: number): void {
    if (index < 0 || index >= this._rules.length) return;
    this._rules.splice(index, 1);
  }

  replaceRule(index: number, rule: CssRule): void {
    if (index < 0 || index >= this._rules.length) return;
    this._rules[index] = rule;
  }

  addRule(rule: CssRule): number {
    const idx = this._rules.length;
    this._rules.push(rule);
    return idx;
  }

  toCssStylesheet(): CssStylesheet {
    return { rules: [...this._rules], url: this.url };
  }

  clear(): void {
    this._rules.length = 0;
  }

  /** Clone the sheet with the same rules but a new id. */
  clone(newId: string): StyleSheet {
    return new StyleSheet(newId, [...this._rules], this.url);
  }

  private _parseRuleText(ruleText: string): CssRule {
    const text = ruleText.trim();
    if (text.startsWith('@')) {
      return {
        type: 'unknown',
        atKeyword: text.includes(' ') ? text.slice(0, text.indexOf(' ')) : text,
        prelude: '',
        body: text,
      };
    }
    const braceIdx = text.indexOf('{');
    if (braceIdx === -1) {
      return {
        type: 'style',
        selectors: [],
        declarations: [],
        specificity: { id: 0, a: 0, b: 0 },
        sourceOrder: this._sourceOrderCounter++,
        sourceUrl: this.url,
      };
    }
    const selectorStr = text.slice(0, braceIdx).trim();
    const declStr = text.slice(braceIdx + 1, text.lastIndexOf('}')).trim();
    const declarations = declStr
      ? declStr.split(';').filter(Boolean).map((d) => {
          const colonIdx = d.indexOf(':');
          if (colonIdx === -1) return { property: d.trim(), value: '', important: false };
          const prop = d.slice(0, colonIdx).trim();
          const rest = d.slice(colonIdx + 1).trim();
          const important = rest.endsWith('!important');
          const value = important ? rest.slice(0, -10).trim() : rest;
          return { property: prop, value, important };
        })
      : [];
    const specificity = this._computeSpecificity(selectorStr);
    const selectors = [{ type: 'compound' as const, tagName: null, id: null, classes: [], attributes: [], pseudoClasses: [], pseudoElement: null }];
    return {
      type: 'style',
      selectors,
      declarations,
      specificity,
      sourceOrder: this._sourceOrderCounter++,
      sourceUrl: this.url,
    } as CssStyleRule;
  }

  private _computeSpecificity(selector: string): CssSpecificity {
    let id = 0, a = 0, b = 0;
    const parts = selector.split(/\s+/);
    for (const part of parts) {
      if (part.startsWith('#')) id++;
      else if (part.startsWith('.')) a++;
      else if (part.startsWith('[')) a++;
      else if (part.startsWith(':')) a++;
      else b++;
    }
    return { id, a, b };
  }
}
