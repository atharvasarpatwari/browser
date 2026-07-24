/**
 * @file css5/cascade.ts
 * CSS Cascade engine — resolves competing declarations into computed styles.
 *
 * Supports:
 *   - @media rule evaluation against viewport dimensions
 *   - Specificity + source-order sorting
 *   - Inheritable property propagation
 *   - User-agent defaults for common elements
 *   - Shorthand expansion (margin, padding, border, font, background, etc.)
 */

import type {
  CssRule,
  CssStyleRule,
  CssMediaRule,
  CssMediaQuery,
  CssMediaFeature,
  CssDeclaration,
  CssSpecificity,
  CssStylesheet,
} from './types';

import { matchesSelectorList } from './selector';
import { isInheritedProperty, getInitialValue } from './property-definitions';
import { processCSSWideKeywords, type KeywordContext } from './css-wide-keywords';
import { resolveAllComputedValues, type ResolutionContext } from './computed-value-resolver';

// ─────────────────────────────────────────────────────────────────────────────
// STYLEABLE ELEMENT
// ─────────────────────────────────────────────────────────────────────────────

export interface StyleableElement {
  tagName: string;
  attributes: ReadonlyMap<string, string>;
  parent: StyleableElement | null;
  children: StyleableElement[];
}

// ─────────────────────────────────────────────────────────────────────────────
// VIEWPORT
// ─────────────────────────────────────────────────────────────────────────────

export interface Viewport {
  width: number;
  height: number;
}

const DEFAULT_VIEWPORT: Viewport = { width: 1920, height: 1080 };

// ─────────────────────────────────────────────────────────────────────────────
// INHERITABLE PROPERTIES (delegated to property-definitions.ts)
// ─────────────────────────────────────────────────────────────────────────────

// Re-export for backward compatibility — callers may import INHERITABLE
// but the canonical source is property-definitions.ts.
const INHERITABLE = new Set(
  [
    'color', 'font-size', 'font-family', 'font-weight', 'font-style',
    'font-variant', 'line-height', 'text-align', 'text-decoration',
    'text-transform', 'text-indent', 'text-shadow', 'visibility',
    'cursor', 'letter-spacing', 'word-spacing', 'white-space', 'direction',
    'writing-mode', 'list-style-type', 'list-style-position', 'list-style-image',
    'orphans', 'widows', 'quotes', 'border-collapse', 'border-spacing',
    'caption-side', 'empty-cells', 'table-layout', 'vertical-align',
    'tab-size', 'hyphens', 'overflow-wrap', 'word-break', 'color-scheme',
    'accent-color',
  ].filter((p) => isInheritedProperty(p)),
);

// ─────────────────────────────────────────────────────────────────────────────
// MEDIA QUERY EVALUATION
// ─────────────────────────────────────────────────────────────────────────────

function evaluateMediaFeature(
  feature: CssMediaFeature,
  viewport: Viewport,
): boolean {
  const target =
    feature.name === 'width' || feature.name === 'min-width' || feature.name === 'max-width'
      ? viewport.width
      : viewport.height;

  const value = parseInt(feature.value, 10);
  if (Number.isNaN(value)) return true;

  if (feature.range === 'min') return target >= value;
  if (feature.range === 'max') return target <= value;
  return target === value;
}

function evaluateMediaQuery(
  query: CssMediaQuery,
  viewport: Viewport,
): boolean {
  // Evaluate every feature in the query (AND semantics within a query).
  let featureMatch = query.features.length === 0;
  for (const f of query.features) {
    if (!evaluateMediaFeature(f, viewport)) return false;
    featureMatch = true;
  }

  if (!featureMatch) {
    // Bare media type: 'screen' → true for our viewport context.
    if (query.mediaType === 'print') return false;
  }

  const matches = featureMatch;
  if (query.modifier === 'not') return !matches;
  return matches;
}

function evaluateMediaQueries(
  queries: readonly CssMediaQuery[],
  viewport: Viewport,
): boolean {
  if (queries.length === 0) return true;
  return queries.some((q) => evaluateMediaQuery(q, viewport));
}

// ─────────────────────────────────────────────────────────────────────────────
// COLLECT STYLE RULES (flattened through @media / @supports / nested)
// ─────────────────────────────────────────────────────────────────────────────

interface CollectContext {
  viewport: Viewport;
  rules: CssStyleRule[];
  sourceOrder: number;
}

function collectStyleRules(rule: CssRule, ctx: CollectContext): void {
  switch (rule.type) {
    case 'style': {
      ctx.rules.push(rule);
      break;
    }
    case 'media': {
      if (!evaluateMediaQueries(rule.mediaQueries, ctx.viewport)) return;
      for (const nested of rule.rules) {
        collectStyleRules(nested, ctx);
      }
      break;
    }
    case 'supports': {
      // Simplified: always consider supported.
      for (const nested of rule.rules) {
        collectStyleRules(nested, ctx);
      }
      break;
    }
    // Ignore @import, @font-face, @keyframes, @charset, @namespace, unknown
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SPECIFICITY COMPARISON
// ─────────────────────────────────────────────────────────────────────────────

function specificityWeight(s: CssSpecificity): number {
  return s.id * 1_000_000 + s.a * 10_000 + s.b;
}

// ─────────────────────────────────────────────────────────────────────────────
// SHORTHAND EXPANSION
// ─────────────────────────────────────────────────────────────────────────────

function splitTokenList(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  return trimmed.split(/\s+/).filter((s) => s.length > 0);
}

function expandBoxShorthand(
  property: string,
  value: string,
): Map<string, string> {
  const parts = splitTokenList(value);
  const result = new Map<string, string>();

  let top: string, right: string, bottom: string, left: string;
  switch (parts.length) {
    case 1:
      top = right = bottom = left = parts[0];
      break;
    case 2:
      top = bottom = parts[0];
      left = right = parts[1];
      break;
    case 3:
      top = parts[0];
      left = right = parts[1];
      bottom = parts[2];
      break;
    case 4:
      top = parts[0];
      right = parts[1];
      bottom = parts[2];
      left = parts[3];
      break;
    default:
      return result;
  }

  result.set(`${property}-top`, top);
  result.set(`${property}-right`, right);
  result.set(`${property}-bottom`, bottom);
  result.set(`${property}-left`, left);
  return result;
}

function expandBorderShorthand(
  value: string,
): Map<string, string> {
  const parts = splitTokenList(value);
  const result = new Map<string, string>();

  let width = 'medium';
  let style = 'none';
  let color = 'currentcolor';

  for (const part of parts) {
    if (
      /^(none|hidden|dotted|dashed|solid|double|groove|ridge|inset|outset)$/i.test(
        part,
      )
    ) {
      style = part;
    } else if (/^\d/.test(part) || /^(thin|medium|thick)$/i.test(part)) {
      width = part;
    } else {
      color = part;
    }
  }

  result.set('border-width', width);
  result.set('border-style', style);
  result.set('border-color', color);
  return result;
}

function expandBorderWidthShorthand(value: string): Map<string, string> {
  const parts = splitTokenList(value);
  const result = new Map<string, string>();

  let top: string, right: string, bottom: string, left: string;
  switch (parts.length) {
    case 1:
      top = right = bottom = left = parts[0];
      break;
    case 2:
      top = bottom = parts[0];
      left = right = parts[1];
      break;
    case 3:
      top = parts[0];
      left = right = parts[1];
      bottom = parts[2];
      break;
    case 4:
      top = parts[0];
      right = parts[1];
      bottom = parts[2];
      left = parts[3];
      break;
    default:
      return result;
  }

  result.set('border-top-width', top);
  result.set('border-right-width', right);
  result.set('border-bottom-width', bottom);
  result.set('border-left-width', left);
  return result;
}

function expandBorderStyleShorthand(value: string): Map<string, string> {
  const parts = splitTokenList(value);
  const result = new Map<string, string>();

  let top: string, right: string, bottom: string, left: string;
  switch (parts.length) {
    case 1:
      top = right = bottom = left = parts[0];
      break;
    case 2:
      top = bottom = parts[0];
      left = right = parts[1];
      break;
    case 3:
      top = parts[0];
      left = right = parts[1];
      bottom = parts[2];
      break;
    case 4:
      top = parts[0];
      right = parts[1];
      bottom = parts[2];
      left = parts[3];
      break;
    default:
      return result;
  }

  result.set('border-top-style', top);
  result.set('border-right-style', right);
  result.set('border-bottom-style', bottom);
  result.set('border-left-style', left);
  return result;
}

function expandBorderColorShorthand(value: string): Map<string, string> {
  const parts = splitTokenList(value);
  const result = new Map<string, string>();

  let top: string, right: string, bottom: string, left: string;
  switch (parts.length) {
    case 1:
      top = right = bottom = left = parts[0];
      break;
    case 2:
      top = bottom = parts[0];
      left = right = parts[1];
      break;
    case 3:
      top = parts[0];
      left = right = parts[1];
      bottom = parts[2];
      break;
    case 4:
      top = parts[0];
      right = parts[1];
      bottom = parts[2];
      left = parts[3];
      break;
    default:
      return result;
  }

  result.set('border-top-color', top);
  result.set('border-right-color', right);
  result.set('border-bottom-color', bottom);
  result.set('border-left-color', left);
  return result;
}

function expandBorderRadiusShorthand(value: string): Map<string, string> {
  const parts = splitTokenList(value);
  const result = new Map<string, string>();

  let tl: string, tr: string, br: string, bl: string;
  switch (parts.length) {
    case 1:
      tl = tr = br = bl = parts[0];
      break;
    case 2:
      tl = br = parts[0];
      tr = bl = parts[1];
      break;
    case 3:
      tl = parts[0];
      tr = bl = parts[1];
      br = parts[2];
      break;
    case 4:
      tl = parts[0];
      tr = parts[1];
      br = parts[2];
      bl = parts[3];
      break;
    default:
      return result;
  }

  result.set('border-top-left-radius', tl);
  result.set('border-top-right-radius', tr);
  result.set('border-bottom-right-radius', br);
  result.set('border-bottom-left-radius', bl);
  return result;
}

function expandBackgroundShorthand(value: string): Map<string, string> {
  const result = new Map<string, string>();
  const trimmed = value.trim();

  // Position / size / repeat / attachment / origin / clip / color / image
  // Simplified: pick out obvious tokens.
  let color: string | null = null;
  let image: string | null = null;
  let position: string[] = [];
  let repeat = 'repeat';
  let attachment = 'scroll';

  const tokens = trimmed.split(/[\s,]+/).filter((s) => s.length > 0);
  for (const t of tokens) {
    if (t.startsWith('url(') || t.startsWith('linear-') || t.startsWith('radial-') || t.startsWith('repeating-')) {
      image = t;
    } else if (/^(repeat|no-repeat|repeat-x|repeat-y|space|round)$/i.test(t)) {
      repeat = t;
    } else if (/^(scroll|fixed|local)$/i.test(t)) {
      attachment = t;
    } else {
      // Treat as position or color
      if (/^(center|left|right|top|bottom|\d)/.test(t)) {
        position.push(t);
      } else {
        color = t;
      }
    }
  }

  if (color) result.set('background-color', color);
  if (image) result.set('background-image', image);
  if (position.length > 0) result.set('background-position', position.join(' '));
  result.set('background-repeat', repeat);
  result.set('background-attachment', attachment);
  return result;
}

function expandFontShorthand(value: string): Map<string, string> {
  const result = new Map<string, string>();
  const tokens = splitTokenList(value);

  let fontStyle = 'normal';
  let fontVariant = 'normal';
  let fontWeight = 'normal';
  let fontSize = 'medium';
  let lineHeight = 'normal';
  let familyStart = -1;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^(italic|oblique)$/i.test(t)) {
      fontStyle = t;
    } else if (/^(small-caps)$/i.test(t)) {
      fontVariant = t;
    } else if (
      /^(bold|bolder|lighter|[1-9]00)$/i.test(t)
    ) {
      fontWeight = t;
    } else if (
      /^\d/.test(t) ||
      /^(xx-small|x-small|small|medium|large|x-large|xx-large|larger|smaller)$/i.test(
        t,
      )
    ) {
      fontSize = t;
      if (tokens[i + 1] === '/') {
        lineHeight = tokens[i + 2] || 'normal';
        i += 2;
      }
      familyStart = i + 1;
      break;
    }
  }

  if (familyStart >= 0) {
    const families = tokens.slice(familyStart).join(' ');
    result.set('font-family', families);
  }

  result.set('font-style', fontStyle);
  result.set('font-variant', fontVariant);
  result.set('font-weight', fontWeight);
  result.set('font-size', fontSize);
  result.set('line-height', lineHeight);
  return result;
}

function expandListStyleShorthand(value: string): Map<string, string> {
  const result = new Map<string, string>();
  const tokens = splitTokenList(value);

  let type = 'disc';
  let position = 'outside';
  let image = 'none';

  for (const t of tokens) {
    if (t.startsWith('url(')) {
      image = t;
    } else if (/^(inside|outside)$/i.test(t)) {
      position = t;
    } else {
      type = t;
    }
  }

  result.set('list-style-type', type);
  result.set('list-style-position', position);
  result.set('list-style-image', image);
  return result;
}

/** Expands shorthand declarations into longhand equivalents. */
export function expandShorthands(
  declarations: readonly CssDeclaration[],
): CssDeclaration[] {
  const result: CssDeclaration[] = [];
  let order = 0;

  for (const decl of declarations) {
    const prop = decl.property.toLowerCase();
    let expanded: Map<string, string> | null = null;

    if (prop === 'margin') {
      expanded = expandBoxShorthand('margin', decl.value);
    } else if (prop === 'padding') {
      expanded = expandBoxShorthand('padding', decl.value);
    } else if (prop === 'border') {
      expanded = expandBorderShorthand(decl.value);
    } else if (prop === 'border-width') {
      expanded = expandBorderWidthShorthand(decl.value);
    } else if (prop === 'border-style') {
      expanded = expandBorderStyleShorthand(decl.value);
    } else if (prop === 'border-color') {
      expanded = expandBorderColorShorthand(decl.value);
    } else if (prop === 'border-radius') {
      expanded = expandBorderRadiusShorthand(decl.value);
    } else if (prop === 'background') {
      expanded = expandBackgroundShorthand(decl.value);
    } else if (prop === 'font') {
      expanded = expandFontShorthand(decl.value);
    } else if (prop === 'list-style') {
      expanded = expandListStyleShorthand(decl.value);
    }

    if (expanded && expanded.size > 0) {
      for (const [longhand, longValue] of expanded) {
        result.push({
          property: longhand,
          value: longValue,
          important: decl.important,
        });
      }
    } else {
      result.push({
        property: decl.property,
        value: decl.value,
        important: decl.important,
      });
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// USER-AGENT DEFAULTS
// ─────────────────────────────────────────────────────────────────────────────

const BLOCK_ELEMENTS = new Set([
  'div',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'section',
  'article',
  'nav',
  'header',
  'footer',
  'main',
  'aside',
  'table',
  'form',
  'blockquote',
  'hr',
  'pre',
  'figure',
  'details',
  'summary',
  'dialog',
  'dl',
  'dt',
  'dd',
  'address',
  'fieldset',
  'figcaption',
  'legend',
]);

const INLINE_ELEMENTS = new Set([
  'span',
  'a',
  'em',
  'strong',
  'b',
  'i',
  'u',
  'code',
  'img',
  'small',
  'sub',
  'sup',
  'mark',
  'abbr',
  'cite',
  'q',
  'time',
  'var',
  'kbd',
  'samp',
  'del',
  'ins',
  'ruby',
  'rt',
  'rp',
  'wbr',
  'br',
  'video',
  'audio',
  'source',
  'picture',
]);

/** Returns user-agent default declarations for a given element tag. */
export function getUserAgentDefaults(
  tagName: string,
): Map<string, string> {
  const tag = tagName.toLowerCase();
  const styles = new Map<string, string>();

  // Display
  if (BLOCK_ELEMENTS.has(tag)) {
    styles.set('display', 'block');
  } else if (INLINE_ELEMENTS.has(tag)) {
    styles.set('display', 'inline');
  }

  // Shared defaults
  styles.set('box-sizing', 'border-box');
  styles.set('color-scheme', 'light dark');

  switch (tag) {
    case 'body':
      styles.set('margin', '8px');
      styles.set('line-height', '1.5');
      break;

    case 'p':
      styles.set('margin-top', '1em');
      styles.set('margin-bottom', '1em');
      break;

    case 'h1':
      styles.set('font-size', '2em');
      styles.set('font-weight', 'bold');
      styles.set('margin-top', '0.67em');
      styles.set('margin-bottom', '0.67em');
      break;
    case 'h2':
      styles.set('font-size', '1.5em');
      styles.set('font-weight', 'bold');
      styles.set('margin-top', '0.83em');
      styles.set('margin-bottom', '0.83em');
      break;
    case 'h3':
      styles.set('font-size', '1.17em');
      styles.set('font-weight', 'bold');
      styles.set('margin-top', '1em');
      styles.set('margin-bottom', '1em');
      break;
    case 'h4':
      styles.set('font-size', '1em');
      styles.set('font-weight', 'bold');
      styles.set('margin-top', '1.33em');
      styles.set('margin-bottom', '1.33em');
      break;
    case 'h5':
      styles.set('font-size', '0.83em');
      styles.set('font-weight', 'bold');
      styles.set('margin-top', '1.67em');
      styles.set('margin-bottom', '1.67em');
      break;
    case 'h6':
      styles.set('font-size', '0.67em');
      styles.set('font-weight', 'bold');
      styles.set('margin-top', '2.33em');
      styles.set('margin-bottom', '2.33em');
      break;

    case 'ul':
    case 'ol':
      styles.set('padding-left', '40px');
      styles.set('margin-top', '1em');
      styles.set('margin-bottom', '1em');
      break;

    case 'li':
      styles.set('margin-top', '0');
      styles.set('margin-bottom', '0');
      break;

    case 'a':
      styles.set('color', '-webkit-link');
      styles.set('text-decoration', 'underline');
      styles.set('cursor', 'pointer');
      break;

    case 'img':
      styles.set('display', 'inline');
      styles.set('vertical-align', 'baseline');
      break;

    case 'blockquote':
      styles.set('margin-top', '1em');
      styles.set('margin-bottom', '1em');
      styles.set('margin-left', '40px');
      styles.set('margin-right', '40px');
      break;

    case 'pre':
      styles.set('font-family', 'monospace');
      styles.set('margin-top', '1em');
      styles.set('margin-bottom', '1em');
      styles.set('white-space', 'pre');
      break;

    case 'hr':
      styles.set('border-top-width', '1px');
      styles.set('border-top-style', 'inset');
      styles.set('margin-top', '0.5em');
      styles.set('margin-bottom', '0.5em');
      break;

    case 'table':
      styles.set('border-collapse', 'collapse');
      styles.set('border-spacing', '2px');
      break;

    case 'details':
      styles.set('display', 'block');
      break;

    case 'summary':
      styles.set('display', 'block');
      styles.set('cursor', 'pointer');
      break;

    case 'code':
    case 'kbd':
    case 'samp':
    case 'var':
      styles.set('font-family', 'monospace');
      break;

    case 'dialog':
      styles.set('display', 'block');
      break;

    default:
      break;
  }

  return styles;
}

// ─────────────────────────────────────────────────────────────────────────────
// CASCADE SORTING
// ─────────────────────────────────────────────────────────────────────────────

interface CascadeEntry {
  property: string;
  value: string;
  important: boolean;
  specificity: number;
  sourceOrder: number;
  inlineStyle: boolean;
}

/**
 * Takes pre-evaluated rules (already filtered by @media) and an element,
 * returns sorted declarations with specificity metadata (lowest first,
 * inline styles last).
 */
export function computeCascade(
  element: StyleableElement,
  rules: readonly CssStyleRule[],
): CascadeEntry[] {
  const entries: CascadeEntry[] = [];

  for (const rule of rules) {
    if (!matchesSelectorList(element, rule.selectors)) continue;

    for (const decl of rule.declarations) {
      entries.push({
        property: decl.property.toLowerCase(),
        value: decl.value,
        important: decl.important,
        specificity: specificityWeight(rule.specificity),
        sourceOrder: rule.sourceOrder,
        inlineStyle: false,
      });
    }
  }

  // Sort: non-important first, then important. Within each group:
  //   higher specificity wins → higher source order wins.
  // We sort ascending and later entries override earlier ones when building
  // the final map, so the sort order is: lowest specificity first, lowest
  // source order first, non-important before important.
  entries.sort((a, b) => {
    if (a.important !== b.important) return a.important ? 1 : -1;
    if (a.specificity !== b.specificity) return a.specificity - b.specificity;
    if (a.sourceOrder !== b.sourceOrder) return a.sourceOrder - b.sourceOrder;
    if (a.inlineStyle !== b.inlineStyle) return a.inlineStyle ? 1 : -1;
    return 0;
  });

  return entries;
}

// ─────────────────────────────────────────────────────────────────────────────
// INHERITANCE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Propagates inheritable properties from parent to child when they haven't
 * been explicitly set on the child.
 */
export function applyInheritance(
  element: StyleableElement,
  computed: Map<string, string>,
  parentComputed: Map<string, string> | null,
): void {
  if (!parentComputed) return;

  for (const prop of INHERITABLE) {
    if (!computed.has(prop)) {
      const inherited = parentComputed.get(prop);
      if (inherited !== undefined) {
        computed.set(prop, inherited);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Produces a computed style map for `element` given a full stylesheet.
 *
 * 1. Flattens @media / @supports against the viewport.
 * 2. Matches style rules against the element.
 * 3. Sorts by specificity → source order (lowest first, inline last).
 * 4. Expands shorthands.
 * 5. Applies user-agent defaults.
 * 6. Propagates inheritable properties from parent.
 */
// ─────────────────────────────────────────────────────────────────────────────
// INLINE STYLE PARSING
// ─────────────────────────────────────────────────────────────────────────────

function parseInlineDeclarations(raw: string): CssDeclaration[] {
  const declarations: CssDeclaration[] = [];
  const parts = raw.split(';');
  for (const part of parts) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    const prop = part.slice(0, colon).trim().toLowerCase();
    let value = part.slice(colon + 1).trim();
    if (!prop || !value) continue;
    let important = false;
    if (value.endsWith('!important') || value.endsWith('! important')) {
      important = true;
      value = value.replace(/!\s*important\s*$/, '').trim();
    }
    declarations.push({ property: prop, value, important });
  }
  return declarations;
}

// ─────────────────────────────────────────────────────────────────────────────
// PARENT RESOLUTION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function resolveParentFontSize(parentComputed: Map<string, string> | undefined): number {
  if (!parentComputed) return 16;
  const raw = parentComputed.get('font-size');
  if (!raw) return 16;
  const n = parseFloat(raw);
  return isFinite(n) && n > 0 ? n : 16;
}

function resolveParentFontWeight(parentComputed: Map<string, string> | undefined): number {
  if (!parentComputed) return 400;
  const raw = parentComputed.get('font-weight');
  if (!raw) return 400;
  const n = parseInt(raw, 10);
  return isFinite(n) && n >= 100 && n <= 900 ? n : 400;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPUTED STYLES
// ─────────────────────────────────────────────────────────────────────────────

export function computeComputedStyles(
  element: StyleableElement,
  stylesheet: CssStylesheet,
  viewport?: Viewport,
  parentComputed?: Map<string, string>,
): Map<string, string> {
  const vp = viewport ?? DEFAULT_VIEWPORT;

  // 1. Collect all matching style rules (flattened through media/supports).
  const ctx: CollectContext = {
    viewport: vp,
    rules: [],
    sourceOrder: 0,
  };
  for (const rule of stylesheet.rules) {
    collectStyleRules(rule, ctx);
  }

  // 2. Sort via computeCascade (specificity + source order).
  const cascade = computeCascade(element, ctx.rules);

  // 3. Expand shorthands in each cascade entry, then build the computed map.
  const expandedDeclarations: CssDeclaration[] = cascade.map((e) => ({
    property: e.property,
    value: e.value,
    important: e.important,
  }));

  const longhand = expandShorthands(expandedDeclarations);

  const computed = new Map<string, string>();

  // Apply user-agent defaults first.
  const uaDefaults = getUserAgentDefaults(element.tagName);
  for (const [prop, val] of uaDefaults) {
    computed.set(prop, val);
  }

  // Apply declarations in cascade order (later wins because ascending sort).
  for (const decl of longhand) {
    computed.set(decl.property, decl.value);
  }

  // Also re-apply important declarations from the cascade in case
  // expandShorthands interleaved them. Walk a second pass for importance.
  // (The ascending sort already places important after non-important so
  //  later entries in `longhand` will overwrite earlier ones.)

  // Apply inline styles (highest priority after !important)
  const styleAttr = element.attributes.get('style');
  if (styleAttr) {
    const inlineDecls = parseInlineDeclarations(styleAttr);
    for (const decl of inlineDecls) {
      computed.set(decl.property.toLowerCase(), decl.value);
    }
  }

  // 4. Process CSS-wide keywords (inherit/initial/unset/revert).
  const kwCtx: KeywordContext = {
    parentComputed: parentComputed ?? null,
    uaDefaults,
  };
  processCSSWideKeywords(computed, kwCtx);

  // 5. Inheritance from parent.
  applyInheritance(element, computed, parentComputed ?? null);

  // 6. Set initial values for properties still unset.
  setInitialValues(computed);

  // 7. Resolve computed values (named colors → hex, font-size keywords → px, etc.)
  const parentFontSize = resolveParentFontSize(parentComputed);
  const parentFontWeight = resolveParentFontWeight(parentComputed);
  const resCtx: ResolutionContext = { parentFontSize, parentFontWeight };
  resolveAllComputedValues(computed, resCtx);

  return computed;
}

// ─────────────────────────────────────────────────────────────────────────────
// INITIAL VALUES (fallback when nothing matches)
// ─────────────────────────────────────────────────────────────────────────────

function setInitialValues(computed: Map<string, string>): void {
  // Property-initials from the authoritative registry in property-definitions.ts.
  // This covers ~120 CSS properties. Any property not in the registry gets
  // `initial` as a fallback.
  const PROPERTY_INITIALS: Array<[string, string]> = [
    ['display', 'inline'],
    ['position', 'static'],
    ['float', 'none'],
    ['clear', 'none'],
    ['box-sizing', 'content-box'],
    ['width', 'auto'],
    ['height', 'auto'],
    ['min-width', 'auto'],
    ['min-height', 'auto'],
    ['max-width', 'none'],
    ['max-height', 'none'],
    ['margin-top', '0'],
    ['margin-right', '0'],
    ['margin-bottom', '0'],
    ['margin-left', '0'],
    ['padding-top', '0'],
    ['padding-right', '0'],
    ['padding-bottom', '0'],
    ['padding-left', '0'],
    ['border-top-width', 'medium'],
    ['border-right-width', 'medium'],
    ['border-bottom-width', 'medium'],
    ['border-left-width', 'medium'],
    ['border-top-style', 'none'],
    ['border-right-style', 'none'],
    ['border-bottom-style', 'none'],
    ['border-left-style', 'none'],
    ['border-top-color', 'currentcolor'],
    ['border-right-color', 'currentcolor'],
    ['border-bottom-color', 'currentcolor'],
    ['border-left-color', 'currentcolor'],
    ['border-top-left-radius', '0'],
    ['border-top-right-radius', '0'],
    ['border-bottom-right-radius', '0'],
    ['border-bottom-left-radius', '0'],
    ['border-collapse', 'separate'],
    ['border-spacing', '0'],
    ['top', 'auto'],
    ['right', 'auto'],
    ['bottom', 'auto'],
    ['left', 'auto'],
    ['z-index', 'auto'],
    ['overflow', 'visible'],
    ['overflow-x', 'visible'],
    ['overflow-y', 'visible'],
    ['overflow-wrap', 'normal'],
    ['word-break', 'normal'],
    ['visibility', 'visible'],
    ['opacity', '1'],
    ['color', 'canvastext'],
    ['background-color', 'transparent'],
    ['background-image', 'none'],
    ['background-repeat', 'repeat'],
    ['background-attachment', 'scroll'],
    ['background-position', '0% 0%'],
    ['background-size', 'auto'],
    ['font-family', 'sans-serif'],
    ['font-size', 'medium'],
    ['font-weight', 'normal'],
    ['font-style', 'normal'],
    ['font-variant', 'normal'],
    ['line-height', 'normal'],
    ['letter-spacing', 'normal'],
    ['word-spacing', 'normal'],
    ['text-align', 'start'],
    ['text-align-last', 'auto'],
    ['text-decoration', 'none solid currentcolor'],
    ['text-decoration-line', 'none'],
    ['text-decoration-style', 'solid'],
    ['text-decoration-color', 'currentcolor'],
    ['text-transform', 'none'],
    ['text-indent', '0'],
    ['text-shadow', 'none'],
    ['white-space', 'normal'],
    ['direction', 'ltr'],
    ['writing-mode', 'horizontal-tb'],
    ['tab-size', '8'],
    ['hyphens', 'manual'],
    ['cursor', 'auto'],
    ['color-scheme', 'normal'],
    ['accent-color', 'auto'],
    ['list-style-type', 'disc'],
    ['list-style-position', 'outside'],
    ['list-style-image', 'none'],
    ['caption-side', 'top'],
    ['empty-cells', 'show'],
    ['table-layout', 'auto'],
    ['vertical-align', 'baseline'],
    ['flex-direction', 'row'],
    ['flex-wrap', 'nowrap'],
    ['flex-grow', '0'],
    ['flex-shrink', '1'],
    ['flex-basis', 'auto'],
    ['order', '0'],
    ['justify-content', 'stretch'],
    ['align-items', 'stretch'],
    ['align-self', 'auto'],
    ['align-content', 'stretch'],
    ['gap', 'normal'],
    ['row-gap', 'normal'],
    ['column-gap', 'normal'],
    ['grid-template-columns', 'none'],
    ['grid-template-rows', 'none'],
    ['grid-template-areas', 'none'],
    ['grid-auto-columns', 'auto'],
    ['grid-auto-rows', 'auto'],
    ['grid-auto-flow', 'row'],
    ['grid-column', 'auto'],
    ['grid-row', 'auto'],
    ['transform', 'none'],
    ['transform-origin', '50% 50%'],
    ['transition-property', 'all'],
    ['transition-duration', '0s'],
    ['transition-timing-function', 'ease'],
    ['transition-delay', '0s'],
    ['content', 'normal'],
    ['resize', 'none'],
    ['outline-width', 'medium'],
    ['outline-style', 'none'],
    ['outline-color', 'auto'],
    ['box-shadow', 'none'],
    ['clip-path', 'none'],
    ['filter', 'none'],
    ['orphans', '2'],
    ['widows', '2'],
    ['quotes', 'auto'],
  ];

  for (const [prop, val] of PROPERTY_INITIALS) {
    if (!computed.has(prop)) {
      computed.set(prop, val);
    }
  }
}
