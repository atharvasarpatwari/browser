/**
 * @file css5/index.ts
 * Re-exports for the CSS5 implementation.
 */

// Types
export type {
  CssToken,
  CssSelector,
  CssCompoundSelector,
  CssComplexSelector,
  CssCombinator,
  CssAttributeSelector,
  CssPseudoClassSelector,
  CssDeclaration,
  CssRule,
  CssStyleRule,
  CssMediaRule,
  CssImportRule,
  CssFontFaceRule,
  CssKeyframesRule,
  CssKeyframe,
  CssCharsetRule,
  CssNamespaceRule,
  CssSupportsRule,
  CssUnknownRule,
  CssMediaQuery,
  CssMediaFeature,
  CssSpecificity,
  CssStylesheet,
  ShorthandDefinition,
} from './types';
export { CssTokenType } from './types';

// Tokenizer
export { CssTokenizer, tokenizeCss, tokenizeCssClean } from './tokenizer';

// Parser
export { CssParser, computeSelectorSpecificity, compareSpecificity, stripComments } from './parser';

// Selector
export { matchesSelector, matchesSelectorList, querySelector, querySelectorAll } from './selector';
export type { SelectableElement } from './selector';

// Cascade
export {
  computeComputedStyles,
  computeCascade,
  applyInheritance,
  getUserAgentDefaults,
  expandShorthands,
} from './cascade';
export type { StyleableElement } from './cascade';

// Property Definitions
export {
  isInheritedProperty,
  getInitialValue,
  isShorthandProperty,
  getLonghands,
  isCSSWideKeyword,
  getInheritedProperties,
  getAllPropertyDefinitions,
} from './property-definitions';

// CSS-Wide Keywords
export {
  resolveCSSWideKeyword,
  isCSSWideKeywordValue,
  extractCSSWideKeyword,
  processCSSWideKeywords,
} from './css-wide-keywords';
export type { KeywordContext } from './css-wide-keywords';

// Computed Value Resolver
export {
  resolveComputedValue,
  resolveAllComputedValues,
  resolveFontSizeKeyword,
  resolveFontWeightKeyword,
  resolveBorderWidthKeyword,
} from './computed-value-resolver';
export type { ResolutionContext } from './computed-value-resolver';

// StyleSheet
export { StyleSheet } from './stylesheet';

// UsedStyle
export { buildUsedStyle } from './used-style';
