/**
 * @file css5/types.ts
 * Core types for the CSS5 implementation.
 */

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN TYPES (CSS Syntax Level 3)
// ─────────────────────────────────────────────────────────────────────────────

export const enum CssTokenType {
  // Basic
  Ident = 'ident',
  Function = 'function',     // e.g. rgb(
  AtKeyword = 'at-keyword',  // e.g. @media
  Hash = 'hash',             // e.g. #fff
  String = 'string',         // '...' or "..."
  BadString = 'bad-string',
  Url = 'url',               // url(...)
  BadUrl = 'bad-url',

  // Numbers
  Number = 'number',
  Percentage = 'percentage',
  Dimension = 'dimension',   // e.g. 10px, 2em

  // Delimiters
  Colon = ':',
  Semicolon = ';',
  Comma = ',',
  SquareBracketOpen = '[',
  SquareBracketClose = ']',
  ParenthesisOpen = '(',
  ParenthesisClose = ')',
  CurlyBracketOpen = '{',
  CurlyBracketClose = '}',
  Space = ' ',
  GreaterThan = '>',
  Plus = '+',
  Tilde = '~',
  Period = '.',
  Equals = '=',
  Asterisk = '*',
  EOF = 'eof',

  // Special
  Whitespace = 'whitespace',
  Comment = 'comment',
  CDOToken = '<!--',
  CDCToken = '-->',
  BadComment = 'bad-comment',
}

export interface CssToken {
  readonly type: CssTokenType;
  readonly value: string;
  readonly start: number;
  readonly end: number;
  readonly sourceLine?: number;
  readonly sourceColumn?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// SELECTOR TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type CssCompoundSelector = {
  readonly type: 'compound';
  readonly tagName: string | null;        // e.g. 'div', null for *
  readonly id: string | null;             // e.g. 'myId'
  readonly classes: readonly string[];    // e.g. ['foo', 'bar']
  readonly attributes: readonly CssAttributeSelector[];
  readonly pseudoClasses: readonly CssPseudoClassSelector[];
  readonly pseudoElement: string | null;  // e.g. 'before', 'after'
};

export type CssComplexSelector = {
  readonly type: 'complex';
  readonly left: CssSelector;             // left-hand side
  readonly combinator: CssCombinator;
  readonly right: CssCompoundSelector;     // right-hand side (always compound)
};

export type CssSelector = CssCompoundSelector | CssComplexSelector;

export type CssCombinator = ' ' | '>' | '+' | '~';

export interface CssAttributeSelector {
  readonly name: string;
  readonly operator: '=' | '~=' | '|=' | '^=' | '$=' | '*=' | null; // null = [attr]
  readonly value: string | null;
  readonly caseInsensitive: boolean;
}

export type CssPseudoClassSelector =
  | { readonly type: 'dynamic'; readonly name: string }
  | { readonly type: 'structural'; readonly name: string; readonly value: string | null }
  | { readonly type: 'negation'; readonly selectors: readonly CssSelector[] }
  | { readonly type: 'is'; readonly selectors: readonly CssSelector[] }
  | { readonly type: 'any'; readonly selectors: readonly CssSelector[] }
  | { readonly type: 'where'; readonly selectors: readonly CssSelector[] }
  | { readonly type: 'has'; readonly selectors: readonly CssSelector[] };

// ─────────────────────────────────────────────────────────────────────────────
// DECLARATION TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface CssDeclaration {
  readonly property: string;
  readonly value: string;
  readonly important: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// RULE TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface CssStyleRule {
  readonly type: 'style';
  readonly selectors: readonly CssSelector[];
  readonly declarations: readonly CssDeclaration[];
  readonly specificity: CssSpecificity;
  readonly sourceOrder: number;
  readonly sourceUrl: string | null;
}

export interface CssMediaRule {
  readonly type: 'media';
  readonly mediaQueries: readonly CssMediaQuery[];
  readonly rules: readonly CssRule[];
}

export interface CssImportRule {
  readonly type: 'import';
  readonly url: string;
  readonly mediaQueries: readonly CssMediaQuery[];
}

export interface CssFontFaceRule {
  readonly type: 'font-face';
  readonly declarations: readonly CssDeclaration[];
}

export interface CssKeyframesRule {
  readonly type: 'keyframes';
  readonly name: string;
  readonly keyframes: readonly CssKeyframe[];
}

export interface CssKeyframe {
  readonly selectors: readonly string[];
  readonly declarations: readonly CssDeclaration[];
}

export interface CssCharsetRule {
  readonly type: 'charset';
  readonly encoding: string;
}

export interface CssNamespaceRule {
  readonly type: 'namespace';
  readonly prefix: string | null;
  readonly url: string;
}

export interface CssSupportsRule {
  readonly type: 'supports';
  readonly condition: string;
  readonly rules: readonly CssRule[];
}

export interface CssLayerRule {
  readonly type: 'layer';
  readonly names: readonly string[];        // empty for anonymous @layer
  readonly rules: readonly CssRule[];       // for @layer name { ... }
}

export interface CssLayerOrderRule {
  readonly type: 'layer-order';
  readonly names: readonly string[];        // @layer a, b, c;
}

export interface CssUnknownRule {
  readonly type: 'unknown';
  readonly atKeyword: string;
  readonly prelude: string;
  readonly body: string;
}

export type CssRule =
  | CssStyleRule
  | CssMediaRule
  | CssImportRule
  | CssFontFaceRule
  | CssKeyframesRule
  | CssCharsetRule
  | CssNamespaceRule
  | CssSupportsRule
  | CssLayerRule
  | CssLayerOrderRule
  | CssUnknownRule;

// ─────────────────────────────────────────────────────────────────────────────
// MEDIA QUERY TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface CssMediaQuery {
  readonly modifier: 'not' | 'only' | null;
  readonly mediaType: string;              // 'all', 'screen', 'print'
  readonly features: readonly CssMediaFeature[];
  readonly conjunction: 'and' | 'or' | null;
}

export interface CssMediaFeature {
  readonly name: string;
  readonly value: string;
  readonly range: 'min' | 'max' | null;   // min-width, max-width
  /** Range syntax operator: (width >= 800px), (400px <= width <= 800px) */
  readonly operator?: '>=' | '<=' | '>' | '<' | null;
  /** For double-range syntax: (400px <= width <= 800px) */
  readonly lowerValue?: string;
  readonly lowerOperator?: '>=' | '<=' | '>' | '<' | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SPECIFICITY
// ─────────────────────────────────────────────────────────────────────────────

export interface CssSpecificity {
  readonly id: number;
  readonly a: number;   // class, attribute, pseudo-class
  readonly b: number;   // type, pseudo-element
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLESHEET
// ─────────────────────────────────────────────────────────────────────────────

export interface CssStylesheet {
  readonly rules: readonly CssRule[];
  readonly url: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SHORTHAND EXPANSION
// ─────────────────────────────────────────────────────────────────────────────

export interface ShorthandDefinition {
  readonly longhands: readonly string[];
  readonly parse: (value: string) => Map<string, string>;
}
