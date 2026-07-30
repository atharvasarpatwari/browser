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
  CssLayerRule,
  CssLayerOrderRule,
  CssContainerRule,
  CssKeyframesRule,
} from './types';

import { matchesSelectorList } from './selector';
import { isInheritedProperty, getInitialValue, getInheritedProperties, getAllPropertyDefinitions } from './property-definitions';
import { processCSSWideKeywords, type KeywordContext } from './css-wide-keywords';
import { resolveComputedValue, resolveAllComputedValues, resolveVarReferences, type ResolutionContext } from './computed-value-resolver';

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
// INHERITABLE PROPERTIES — canonical source: property-definitions.ts
// ─────────────────────────────────────────────────────────────────────────────

const INHERITABLE = new Set(getInheritedProperties());

// ─────────────────────────────────────────────────────────────────────────────
// MEDIA QUERY EVALUATION
// ─────────────────────────────────────────────────────────────────────────────

function evaluateMediaFeature(
  feature: CssMediaFeature,
  viewport: Viewport,
): boolean {
  const name = feature.name.toLowerCase();

  // Range syntax helper
  const applyRange = (actual: number, target: number, op: string | undefined): boolean => {
    if (!op) return actual === target;
    switch (op) {
      case '>=': return actual >= target;
      case '<=': return actual <= target;
      case '>':  return actual > target;
      case '<':  return actual < target;
      default:   return actual === target;
    }
  };

  // Width/height features
  if (name === 'width' || name === 'min-width' || name === 'max-width') {
    const value = parseInt(feature.value, 10);
    if (Number.isNaN(value)) return true;
    // Range syntax: (width >= 800px) or (400px <= width <= 800px)
    if (feature.operator) {
      // Double range: (lowerValue lowerOp feature upperOp upperValue)
      // lowerOp is reversed: (400px <= width) means width >= 400
      const flipOp = (op: string): string => {
        switch (op) {
          case '<=': return '>=';
          case '>=': return '<=';
          case '<':  return '>';
          case '>':  return '<';
          default:   return op;
        }
      };
      const lowerOk = feature.lowerOperator && feature.lowerValue !== undefined
        ? applyRange(viewport.width, parseInt(feature.lowerValue, 10), flipOp(feature.lowerOperator))
        : true;
      const upperOk = applyRange(viewport.width, value, feature.operator);
      return lowerOk && upperOk;
    }
    if (feature.range === 'min') return viewport.width >= value;
    if (feature.range === 'max') return viewport.width <= value;
    return viewport.width === value;
  }
  if (name === 'height' || name === 'min-height' || name === 'max-height') {
    const value = parseInt(feature.value, 10);
    if (Number.isNaN(value)) return true;
    // Range syntax
    if (feature.operator) {
      const flipOp = (op: string): string => {
        switch (op) {
          case '<=': return '>=';
          case '>=': return '<=';
          case '<':  return '>';
          case '>':  return '<';
          default:   return op;
        }
      };
      const lowerOk = feature.lowerOperator && feature.lowerValue !== undefined
        ? applyRange(viewport.height, parseInt(feature.lowerValue, 10), flipOp(feature.lowerOperator))
        : true;
      const upperOk = applyRange(viewport.height, value, feature.operator);
      return lowerOk && upperOk;
    }
    if (feature.range === 'min') return viewport.height >= value;
    if (feature.range === 'max') return viewport.height <= value;
    return viewport.height === value;
  }

  // Orientation
  if (name === 'orientation') {
    return viewport.width <= viewport.height
      ? feature.value.toLowerCase() === 'portrait'
      : feature.value.toLowerCase() === 'landscape';
  }

  // Aspect ratio
  if (name === 'aspect-ratio' || name === 'min-aspect-ratio' || name === 'max-aspect-ratio') {
    const parts = feature.value.split('/').map(s => parseInt(s.trim(), 10));
    if (parts.length !== 2 || isNaN(parts[0]!) || isNaN(parts[1]!) || parts[1] === 0) return true;
    const ratio = viewport.width / viewport.height;
    const targetRatio = parts[0]! / parts[1]!;
    if (feature.range === 'min') return ratio >= targetRatio;
    if (feature.range === 'max') return ratio <= targetRatio;
    return Math.abs(ratio - targetRatio) < 0.01;
  }

  // Resolution (dpi/dppx)
  if (name === 'resolution' || name === 'min-resolution' || name === 'max-resolution') {
    // Assume 96dpi (1dppx) for screen
    const deviceDpi = 96;
    const valueStr = feature.value.toLowerCase();
    let targetDpi = parseInt(valueStr, 10);
    if (isNaN(targetDpi)) return true;
    if (valueStr.includes('dppx')) targetDpi *= 96;
    else if (valueStr.includes('cm')) targetDpi *= 2.54;
    if (feature.range === 'min') return deviceDpi >= targetDpi;
    if (feature.range === 'max') return deviceDpi <= targetDpi;
    return deviceDpi === targetDpi;
  }

  // Boolean features (no value) — return true for screen context
  if (!feature.value || feature.value === '') {
    return true;
  }

  // Color / color-gamut / prefers-color-scheme / prefers-contrast /
  // prefers-reduced-motion / prefers-reduced-transparency /
  // dynamic-range / forced-colors / inverted-colors / pointer / hover / any-pointer / any-hover
  // Simplified: return reasonable defaults for common features.
  const val = feature.value.toLowerCase();
  switch (name) {
    case 'prefers-color-scheme':
      // Default to light mode
      return val === 'light';
    case 'prefers-contrast':
      return val === 'no-preference';
    case 'prefers-reduced-motion':
      return val === 'no-preference';
    case 'prefers-reduced-transparency':
      return val === 'no-preference';
    case 'dynamic-range':
      return val === 'standard';
    case 'forced-colors':
      return val === 'none';
    case 'inverted-colors':
      return val === 'none';
    case 'pointer':
      return val === 'fine'; // Assume mouse
    case 'hover':
      return val === 'hover'; // Assume hover capable
    case 'any-pointer':
      return val === 'fine';
    case 'any-hover':
      return val === 'hover';
    case 'update-frequency':
      return val === 'fast';
    case 'overflow-block':
      return val === 'scroll';
    case 'overflow-inline':
      return val === 'scroll';
    case 'display-mode':
      return val === 'browser'; // or 'window'
    case 'color':
    case 'color-gamut':
      return true;
    default:
      return true;
  }
}

function evaluateMediaType(mediaType: string): boolean {
  switch (mediaType) {
    case 'all':
      return true;
    case 'screen':
      return true;   // Nova renders in screen context
    case 'print':
      return false;  // No print rendering
    default:
      return true;
  }
}

function evaluateMediaQuery(
  query: CssMediaQuery,
  viewport: Viewport,
): boolean {
  // 1. Match media type
  const typeMatch = evaluateMediaType(query.mediaType);

  // 2. Evaluate features (AND semantics within a query)
  let featureMatch = true;
  for (const f of query.features) {
    if (!evaluateMediaFeature(f, viewport)) {
      featureMatch = false;
      break;
    }
  }

  // 3. Combine: type AND features
  const result = typeMatch && featureMatch;

  // 4. Apply modifier (not inverts the full result; only is a no-op)
  if (query.modifier === 'not') return !result;
  return result;
}

function evaluateMediaQueries(
  queries: readonly CssMediaQuery[],
  viewport: Viewport,
): boolean {
  if (queries.length === 0) return true;
  return queries.some((q) => evaluateMediaQuery(q, viewport));
}

// ─────────────────────────────────────────────────────────────────────────────
// @SUPPORTS CONDITION EVALUATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a single `property: value` declaration is supported.
 * "Supported" means the property exists in the property definitions registry.
 * If a value is provided, we do a basic sanity check (not empty).
 */
function evaluateSupportsDeclaration(condition: string): boolean {
  const colonIdx = condition.indexOf(':');
  if (colonIdx === -1) {
    // Boolean form: `(property)` — check if property is known
    const prop = condition.trim().toLowerCase();
    if (!prop) return false;
    const defs = getAllPropertyDefinitions();
    return prop in defs;
  }
  const prop = condition.slice(0, colonIdx).trim().toLowerCase();
  const value = condition.slice(colonIdx + 1).trim();
  if (!prop) return false;
  const defs = getAllPropertyDefinitions();
  if (!(prop in defs)) return false;
  // Basic value check: non-empty and not obviously invalid
  if (!value) return false;
  return true;
}

/**
 * Evaluate a single @supports condition token (inner content of parentheses).
 * Handles: `(property: value)`, `(property)`, and bare declarations.
 */
function evaluateSupportsAtom(condition: string): boolean {
  const trimmed = condition.trim();
  // Strip outer parentheses if present
  const inner = trimmed.startsWith('(') && trimmed.endsWith(')')
    ? trimmed.slice(1, -1).trim()
    : trimmed;
  return evaluateSupportsDeclaration(inner);
}

/**
 * Evaluate a full @supports condition string.
 * Supports: not, and, or, parenthesized grouping.
 *
 * Grammar (simplified):
 *   condition = orExpr
 *   orExpr    = andExpr ('or' andExpr)*
 *   andExpr   = atom ('and' atom)*
 *   atom      = '(' condition ')' | 'not' atom | declaration
 */
function evaluateSupportsCondition(condition: string): boolean {
  const trimmed = condition.trim();
  if (!trimmed) return true;

  // Try to split on 'or' first (lowest precedence)
  const orParts = splitOnBoolean(trimmed, 'or');
  if (orParts.length > 1) {
    return orParts.some(part => evaluateSupportsCondition(part));
  }

  // Then split on 'and'
  const andParts = splitOnBoolean(trimmed, 'and');
  if (andParts.length > 1) {
    return andParts.every(part => evaluateSupportsCondition(part));
  }

  // Handle 'not'
  if (/^\s*not\s+/i.test(trimmed)) {
    const inner = trimmed.replace(/^\s*not\s+/i, '').trim();
    return !evaluateSupportsCondition(inner);
  }

  // Handle parenthesized group
  if (trimmed.startsWith('(') && findMatchingParen(trimmed, 0) === trimmed.length - 1) {
    return evaluateSupportsCondition(trimmed.slice(1, -1).trim());
  }

  // Bare declaration
  return evaluateSupportsAtom(trimmed);
}

/** Find the index of the matching closing paren for the opening paren at `start`. */
function findMatchingParen(s: string, start: number): number {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Split a condition string on a boolean keyword (`and` / `or`),
 * respecting parentheses. Returns an array of sub-conditions.
 */
// ─────────────────────────────────────────────────────────────────────────────
// @CONTAINER QUERY EVALUATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate a container query condition string.
 * Supports: (min-width: Npx), (max-width: Npx), (width > Npx), 
 *           not, and, or operators.
 * Uses viewport dimensions as a fallback when container dimensions are unknown.
 */
function evaluateContainerQuery(query: string, viewport: Viewport): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;

  // Handle 'not'
  if (/^\s*not\s+/i.test(trimmed)) {
    return !evaluateContainerQuery(trimmed.replace(/^\s*not\s+/i, '').trim(), viewport);
  }

  // Split on 'or' (lowest precedence)
  const orParts = splitOnKeyword(trimmed, 'or');
  if (orParts.length > 1) {
    return orParts.some(part => evaluateContainerQuery(part.trim(), viewport));
  }

  // Split on 'and'
  const andParts = splitOnKeyword(trimmed, 'and');
  if (andParts.length > 1) {
    return andParts.every(part => evaluateContainerQuery(part.trim(), viewport));
  }

  // Strip outer parentheses
  const inner = trimmed.startsWith('(') && findMatchingParen(trimmed, 0) === trimmed.length - 1
    ? trimmed.slice(1, -1).trim()
    : trimmed;

  // Parse size feature: (min-width: Npx), (width >= Npx), etc.
  const featureMatch = inner.match(/^\s*(min-|max-)?(width|height|inline-size|block-size|aspect-ratio)\s*(:\s*|>=?|<=?)\s*(.+?)\s*$/i);
  if (!featureMatch) return true;

  const prefix = (featureMatch[1] ?? '').toLowerCase();
  const feature = featureMatch[2]!.toLowerCase();
  const op = featureMatch[3]!.trim();
  const rawValue = featureMatch[4]!;

  const value = parseFloat(rawValue);
  if (isNaN(value)) return true;

  const dim = (feature === 'width' || feature === 'inline-size') ? viewport.width : viewport.height;

  if (op === ':') {
    // Traditional syntax: (min-width: 700px)
    if (prefix === 'min-') return dim >= value;
    if (prefix === 'max-') return dim <= value;
    return dim === value;
  }

  // Range syntax: (width >= 700px)
  switch (op) {
    case '>=': return dim >= value;
    case '<=': return dim <= value;
    case '>':  return dim > value;
    case '<':  return dim < value;
    default:   return true;
  }
}

function splitOnKeyword(condition: string, keyword: string): string[] {
  const parts: string[] = [];
  const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
  let lastIndex = 0;
  let depth = 0;
  let m: RegExpExecArray | null;

  while ((m = regex.exec(condition)) !== null) {
    for (let i = lastIndex; i < m.index; i++) {
      if (condition[i] === '(') depth++;
      else if (condition[i] === ')') depth--;
    }
    if (depth === 0) {
      const part = condition.slice(lastIndex, m.index).trim();
      if (part) parts.push(part);
      lastIndex = m.index + m[0].length;
    }
  }
  const remaining = condition.slice(lastIndex).trim();
  if (remaining) parts.push(remaining);
  return parts;
}

function splitOnBoolean(condition: string, keyword: string): string[] {
  const parts: string[] = [];
  const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
  let lastIndex = 0;
  let depth = 0;
  let m: RegExpExecArray | null;

  while ((m = regex.exec(condition)) !== null) {
    // Check if we're inside parentheses
    for (let i = lastIndex; i < m.index; i++) {
      if (condition[i] === '(') depth++;
      else if (condition[i] === ')') depth--;
    }
    if (depth === 0) {
      const part = condition.slice(lastIndex, m.index).trim();
      if (part) parts.push(part);
      lastIndex = m.index + m[0].length;
    }
  }
  const remaining = condition.slice(lastIndex).trim();
  if (remaining) parts.push(remaining);
  return parts;
}

// ─────────────────────────────────────────────────────────────────────────────
// COLLECT STYLE RULES (flattened through @media / @supports / nested)
// ─────────────────────────────────────────────────────────────────────────────

interface CollectContext {
  viewport: Viewport;
  rules: CssStyleRule[];
  sourceOrder: number;
  /** Layer names in declaration order (first declared = lowest priority). */
  layerOrder: string[];
  /** Current layer name (null = unlayered). */
  currentLayer: string | null;
  /** Maps each style rule to its layer name (if any). */
  layerMap: Map<CssStyleRule, string>;
  /** Collected @keyframes rules indexed by name. */
  keyframes: Map<string, CssKeyframesRule>;
}

function collectStyleRules(rule: CssRule, ctx: CollectContext): void {
  switch (rule.type) {
    case 'style': {
      ctx.rules.push(rule);
      if (ctx.currentLayer) {
        ctx.layerMap.set(rule, ctx.currentLayer);
      }
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
      if (!evaluateSupportsCondition(rule.condition)) break;
      for (const nested of rule.rules) {
        collectStyleRules(nested, ctx);
      }
      break;
    }
    case 'layer': {
      // @layer name { ... } — nested rules inherit this layer context.
      // Register layer names in declaration order if not already present.
      for (const name of rule.names) {
        if (name && !ctx.layerOrder.includes(name)) {
          ctx.layerOrder.push(name);
        }
      }
      const layerName = rule.names.length > 0 ? rule.names[0]! : ctx.currentLayer;
      const prevLayer = ctx.currentLayer;
      ctx.currentLayer = layerName;
      for (const nested of rule.rules) {
        collectStyleRules(nested, ctx);
      }
      ctx.currentLayer = prevLayer;
      break;
    }
    case 'container': {
      if (!evaluateContainerQuery(rule.query, ctx.viewport)) return;
      for (const nested of rule.rules) {
        collectStyleRules(nested, ctx);
      }
      break;
    }
    case 'layer-order': {
      // @layer a, b, c; — declares layer order (names listed first = lowest priority).
      for (let i = rule.names.length - 1; i >= 0; i--) {
        const name = rule.names[i]!;
        if (name && !ctx.layerOrder.includes(name)) {
          // Insert at beginning so first-declared = lowest index
          ctx.layerOrder.unshift(name);
        }
      }
      break;
    }
    case 'import': {
      // Evaluate media queries — if they don't match, skip the import entirely.
      // When the imported stylesheet's rules are available (via network layer),
      // they will be nested inside this rule. If the media queries match, we
      // recurse into those nested rules; otherwise we skip.
      if (rule.mediaQueries.length > 0 &&
          !evaluateMediaQueries(rule.mediaQueries, ctx.viewport)) {
        break;
      }
      // If the import has pre-resolved rules (embedded or pre-fetched), apply them.
      const importRules = (rule as any).rules as CssRule[] | undefined;
      if (importRules) {
        for (const nested of importRules) {
          collectStyleRules(nested, ctx);
        }
      }
      break;
    }
    case 'keyframes': {
      ctx.keyframes.set(rule.name, rule);
      break;
    }
    // Ignore @font-face, @charset, @namespace, unknown
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

  // Expand directly to longhand (border-top-*, border-right-*, etc.)
  const sides = ['border-top', 'border-right', 'border-bottom', 'border-left'];
  for (const side of sides) {
    result.set(`${side}-width`, width);
    result.set(`${side}-style`, style);
    result.set(`${side}-color`, color);
  }
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

  let fontStyle = 'normal';
  let fontVariant = 'normal';
  let fontWeight = 'normal';
  let fontSize = 'medium';
  let lineHeight = 'normal';
  let familyStart = -1;

  // Tokenize respecting quoted strings and slashes for line-height
  const tokens: string[] = [];
  let i = 0;
  const trimmed = value.trim();
  while (i < trimmed.length) {
    // Skip whitespace
    while (i < trimmed.length && /\s/.test(trimmed[i]!)) i++;
    if (i >= trimmed.length) break;

    // Quoted string
    if (trimmed[i] === '"' || trimmed[i] === "'") {
      const quote = trimmed[i]!;
      let token = quote;
      i++;
      while (i < trimmed.length && trimmed[i] !== quote) {
        if (trimmed[i] === '\\') { i++; }
        if (i < trimmed.length) { token += trimmed[i]!; i++; }
      }
      if (i < trimmed.length) { token += trimmed[i]!; i++; } // closing quote
      tokens.push(token);
      continue;
    }

    // Slash (for font-size/line-height)
    if (trimmed[i] === '/') {
      tokens.push('/');
      i++;
      continue;
    }

    // Regular token
    let token = '';
    while (i < trimmed.length && !/\s/.test(trimmed[i]!) && trimmed[i] !== '/' &&
           trimmed[i] !== '"' && trimmed[i] !== "'") {
      token += trimmed[i]!;
      i++;
    }
    if (token) tokens.push(token);
  }

  for (let j = 0; j < tokens.length; j++) {
    const t = tokens[j]!;
    if (/^(italic|oblique)$/i.test(t)) {
      fontStyle = t;
    } else if (/^(small-caps)$/i.test(t)) {
      fontVariant = t;
    } else if (/^(bold|bolder|lighter|[1-9]00)$/i.test(t)) {
      fontWeight = t;
    } else if (
      /^\d/.test(t) ||
      /^(xx-small|x-small|small|medium|large|x-large|xx-large|larger|smaller)$/i.test(t)
    ) {
      fontSize = t;
      // Check for /line-height
      if (tokens[j + 1] === '/') {
        lineHeight = tokens[j + 2] || 'normal';
        j += 2;
      }
      familyStart = j + 1;
      break;
    }
  }

  if (familyStart >= 0) {
    // Join remaining tokens as font-family (handles quoted names and commas)
    // Don't add space after commas for proper "Arial", sans-serif formatting
    const familyTokens = tokens.slice(familyStart);
    let families = '';
    for (let k = 0; k < familyTokens.length; k++) {
      const t = familyTokens[k]!;
      if (t === ',') {
        families += ', ';
      } else if (k > 0 && familyTokens[k - 1] !== ',') {
        families += ' ' + t;
      } else {
        families += t;
      }
    }
    result.set('font-family', families.trim());
  }

  result.set('font-style', fontStyle);
  result.set('font-variant', fontVariant);
  result.set('font-weight', fontWeight);
  result.set('font-size', fontSize);
  result.set('line-height', lineHeight);
  return result;
}

function expandAnimationShorthand(value: string): Map<string, string> {
  const result = new Map<string, string>();
  const tokens = splitTokenList(value);
  if (tokens.length === 0) return result;

  // animation: name duration timing-function delay iteration-count direction fill-mode play-state
  // The only required value is the animation-name; everything else is optional and positional.
  // We use a simple heuristic: known keywords are matched to their property.
  let name = 'none', duration = '0s', timing = 'ease', delay = '0s';
  let iteration = '1', direction = 'normal', fill = 'none', playState = 'running';
  let parsedDuration = false, parsedTiming = false, parsedDelay = false;
  let parsedIteration = false, parsedDirection = false, parsedFill = false, parsedPlayState = false;

  for (const t of tokens) {
    const tl = t.toLowerCase();
    // Directions
    if (!parsedDirection && /^(normal|reverse|alternate|alternate-reverse)$/i.test(t)) {
      direction = tl === 'alternate' ? 'alternate' : tl;
      parsedDirection = true;
      continue;
    }
    // Fill modes
    if (!parsedFill && /^(none|forwards|backwards|both)$/i.test(t)) {
      fill = tl;
      parsedFill = true;
      continue;
    }
    // Play state
    if (!parsedPlayState && /^(running|paused)$/i.test(t)) {
      playState = tl;
      parsedPlayState = true;
      continue;
    }
    // Timing functions
    if (!parsedTiming && /^(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|cubic-bezier|steps)/i.test(t)) {
      timing = t;
      parsedTiming = true;
      continue;
    }
    // Durations/delays (time values with s or ms)
    if (/^[\d.]+(ms|s)$/i.test(t)) {
      if (!parsedDuration) {
        duration = t;
        parsedDuration = true;
        continue;
      }
      if (!parsedDelay) {
        delay = t;
        parsedDelay = true;
        continue;
      }
    }
    // Iteration count (numbers, including infinite)
    if (!parsedIteration && /^(\d+(\.\d+)?|infinite)$/i.test(t)) {
      iteration = t;
      parsedIteration = true;
      continue;
    }
    // Fallback: treat as animation-name (first unrecognized token)
    if (name === 'none') {
      name = t;
    }
  }

  result.set('animation-name', name);
  result.set('animation-duration', duration);
  result.set('animation-timing-function', timing);
  result.set('animation-delay', delay);
  result.set('animation-iteration-count', iteration);
  result.set('animation-direction', direction);
  result.set('animation-fill-mode', fill);
  result.set('animation-play-state', playState);
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
    } else if (prop === 'animation') {
      expanded = expandAnimationShorthand(decl.value);
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
      styles.set('margin-top', '8px');
      styles.set('margin-right', '8px');
      styles.set('margin-bottom', '8px');
      styles.set('margin-left', '8px');
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
  /** Layer index: -1 = unlayered (highest priority), >= 0 = layer declaration order. */
  layerIndex: number;
  /** Layer name for revert-layer tracking, or null for unlayered. */
  layerName: string | null;
}

/**
 * Takes pre-evaluated rules (already filtered by @media) and an element,
 * returns sorted declarations with specificity metadata (lowest first,
 * inline styles last).
 *
 * Layer ordering (CSS Cascading Level 5):
 *   - Unlayered styles beat all layered styles.
 *   - Within layers, later-declared layers beat earlier-declared layers.
 *   - Within the same layer, normal specificity + source order applies.
 */
export function computeCascade(
  element: StyleableElement,
  rules: readonly CssStyleRule[],
  layerOrder?: readonly string[],
  layerMap?: ReadonlyMap<CssStyleRule, string>,
): CascadeEntry[] {
  const entries: CascadeEntry[] = [];

  for (const rule of rules) {
    if (!matchesSelectorList(element, rule.selectors)) continue;

    // Determine layer index: -1 = unlayered (wins over all layers)
    let layerIndex = -1;
    let layerName: string | null = null;
    if (layerMap) {
      const ln = layerMap.get(rule);
      if (ln && layerOrder) {
        const idx = layerOrder.indexOf(ln);
        if (idx >= 0) layerIndex = idx;
        layerName = ln;
      }
    }

    for (const decl of rule.declarations) {
      entries.push({
        property: decl.property.toLowerCase(),
        value: decl.value,
        important: decl.important,
        specificity: specificityWeight(rule.specificity),
        sourceOrder: rule.sourceOrder,
        inlineStyle: false,
        layerIndex,
        layerName,
      });
    }
  }

  // Sort ascending — later entries override earlier ones.
  // Order: non-important < important; unlayered (-1) beats layered (>=0);
  //   within same layer: lower specificity < higher; lower source < higher.
  entries.sort((a, b) => {
    if (a.important !== b.important) return a.important ? 1 : -1;
    // Unlayered (-1) beats layered (>=0) — unlayered sorts AFTER layered
    // so it overrides when iterating ascending.
    if (a.layerIndex !== b.layerIndex) {
      // Both unlayered: compare normally
      if (a.layerIndex === -1 && b.layerIndex === -1) return 0;
      // One unlayered: it wins (sorts later = higher priority)
      if (a.layerIndex === -1) return 1;
      if (b.layerIndex === -1) return -1;
      // Both layered: higher layer index = declared later = higher priority
      return a.layerIndex - b.layerIndex;
    }
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

  // 1. Collect all matching style rules (flattened through media/supports/layers).
  const ctx: CollectContext = {
    viewport: vp,
    rules: [],
    sourceOrder: 0,
    layerOrder: [],
    currentLayer: null,
    layerMap: new Map(),
    keyframes: new Map(),
  };
  for (const rule of stylesheet.rules) {
    collectStyleRules(rule, ctx);
  }

  // 2. Sort via computeCascade (specificity + source order + layer order).
  const cascade = computeCascade(element, ctx.rules, ctx.layerOrder, ctx.layerMap);

  // 3. Build custom properties map early (parent + local --* declarations + inline --*)
  //    so we can resolve var() BEFORE shorthand expansion.
  const earlyCustomProps = new Map<string, string>();
  // Inherit from parent first.
  if (parentComputed) {
    for (const [prop, val] of parentComputed) {
      if (prop.startsWith('--')) earlyCustomProps.set(prop, val);
    }
  }
  // Apply local --* declarations in cascade order (later wins).
  for (const e of cascade) {
    if (e.property.startsWith('--')) earlyCustomProps.set(e.property, e.value);
  }
  // Also include inline style --* declarations (they override cascade).
  const styleAttr = element.attributes.get('style');
  const inlineDecls = styleAttr ? parseInlineDeclarations(styleAttr) : [];
  for (const d of inlineDecls) {
    if (d.property.startsWith('--')) earlyCustomProps.set(d.property, d.value);
  }

  // 4. Resolve var() in all declarations BEFORE shorthand expansion.
  const resolvedDeclarations: CssDeclaration[] = cascade.map((e) => ({
    property: e.property,
    value: e.property.startsWith('--') ? e.value : resolveVarReferences(e.value, earlyCustomProps),
    important: e.important,
  }));

  // 5. Expand shorthands (var() already resolved, so multi-token values work).
  const longhand = expandShorthands(resolvedDeclarations);

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

  // Apply inline styles — split into important and non-important.
  // Per CSS spec, inline !important beats stylesheet !important.
  if (inlineDecls.length > 0) {
    // Resolve var() in inline declarations using the custom properties collected so far.
    const inlineResolved = inlineDecls.map((d) => ({
      property: d.property,
      value: d.property.startsWith('--') ? d.value : resolveVarReferences(d.value, earlyCustomProps),
      important: d.important,
    }));
    // Non-important inline styles apply first (override cascade but can be overridden by stylesheet !important)
    for (const decl of inlineResolved) {
      if (!decl.important) {
        computed.set(decl.property.toLowerCase(), decl.value);
      }
    }
    // Re-apply stylesheet !important declarations that should beat non-important inline.
    for (const decl of longhand) {
      if (decl.important) {
        computed.set(decl.property, decl.value);
      }
    }
    // Finally, inline !important wins over everything.
    for (const decl of inlineResolved) {
      if (decl.important) {
        computed.set(decl.property.toLowerCase(), decl.value);
      }
    }
  }

  // 6. Process CSS-wide keywords (inherit/initial/unset/revert).
  //    Skip custom properties (--*) — they store raw token values, not keywords.
  const kwCtx: KeywordContext = {
    parentComputed: parentComputed ?? null,
    uaDefaults,
    cascadeEntries: cascade,
    layerOrder: ctx.layerOrder,
  };
  processCSSWideKeywords(computed, kwCtx);

  // 7. Inheritance from parent (also inherits custom properties).
  applyInheritance(element, computed, parentComputed ?? null);

  // Also inherit custom properties (--*) from parent if not set locally.
  if (parentComputed) {
    for (const [prop, val] of parentComputed) {
      if (prop.startsWith('--') && !computed.has(prop)) {
        computed.set(prop, val);
      }
    }
  }

  // 8. Set initial values for properties still unset.
  setInitialValues(computed);

  // 9. Collect custom properties for computed value resolution (var() in inherited values).
  const customProps = new Map<string, string>();
  for (const [prop, val] of computed) {
    if (prop.startsWith('--')) {
      customProps.set(prop, val);
    }
  }

  // 10. Resolve computed values (named colors → hex, font-size keywords → px, etc.)
  //     var() is already resolved at this point.
  const parentFontSize = resolveParentFontSize(parentComputed);
  const parentFontWeight = resolveParentFontWeight(parentComputed);

  // First pass: resolve color to get the resolved currentcolor value.
  const colorVal = computed.get('color');
  if (colorVal !== undefined) {
    computed.set('color', resolveComputedValue('color', colorVal, { parentFontSize, parentFontWeight, customProperties: customProps }));
  }
  const currentColor = computed.get('color') ?? 'canvastext';

  // Second pass: resolve all remaining values with the resolved currentcolor.
  const resCtx: ResolutionContext = { parentFontSize, parentFontWeight, currentColor, customProperties: customProps };
  resolveAllComputedValues(computed, resCtx);

  return computed;
}

// ─────────────────────────────────────────────────────────────────────────────
// INITIAL VALUES — delegated to property-definitions.ts registry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Collect all @keyframes rules from a stylesheet into a name-indexed map.
 */
export function collectKeyframes(stylesheet: CssStylesheet): Map<string, CssKeyframesRule> {
  const keyframes = new Map<string, CssKeyframesRule>();
  function walk(rules: readonly CssRule[]): void {
    for (const rule of rules) {
      if (rule.type === 'keyframes') {
        keyframes.set(rule.name, rule);
      } else if (rule.type === 'media' || rule.type === 'supports' || rule.type === 'layer' || rule.type === 'container') {
        walk((rule as any).rules ?? []);
      }
    }
  }
  walk(stylesheet.rules);
  return keyframes;
}

function setInitialValues(computed: Map<string, string>): void {
  // Walk the computed map and fill in missing properties with their
  // CSS-spec initial values from the authoritative registry.
  // We iterate a snapshot of keys to avoid mutating during iteration.
  const keys = [...computed.keys()];
  for (const prop of keys) {
    // Already set — skip
  }

  // Also set any well-known properties that aren't in the computed map yet.
  // This ensures every property in the registry has a value after this step.
  const ALL_PROPERTIES = [
    'display', 'position', 'float', 'clear', 'box-sizing',
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
    'border-collapse', 'border-spacing',
    'top', 'right', 'bottom', 'left', 'z-index',
    'overflow', 'overflow-x', 'overflow-y', 'overflow-wrap', 'word-break',
    'visibility', 'opacity',
    'color', 'background-color', 'background-image', 'background-repeat',
    'background-attachment', 'background-position', 'background-size',
    'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
    'line-height', 'letter-spacing', 'word-spacing',
    'text-align', 'text-align-last', 'text-decoration', 'text-decoration-line',
    'text-decoration-style', 'text-decoration-color',
    'text-transform', 'text-indent', 'text-shadow',
    'white-space', 'direction', 'writing-mode',
    'tab-size', 'hyphens', 'cursor', 'color-scheme', 'accent-color',
    'list-style-type', 'list-style-position', 'list-style-image',
    'caption-side', 'empty-cells', 'table-layout', 'vertical-align',
    'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis',
    'order', 'justify-content', 'align-items', 'align-self', 'align-content',
    'gap', 'row-gap', 'column-gap',
    'grid-template-columns', 'grid-template-rows', 'grid-template-areas',
    'grid-auto-columns', 'grid-auto-rows', 'grid-auto-flow',
    'grid-column', 'grid-row',
    'transform', 'transform-origin',
    'transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay',
    'animation-name', 'animation-duration', 'animation-timing-function', 'animation-delay',
    'animation-iteration-count', 'animation-direction', 'animation-fill-mode', 'animation-play-state',
    'content', 'resize',
    'outline-width', 'outline-style', 'outline-color',
    'box-shadow', 'clip-path', 'filter',
    'orphans', 'widows', 'quotes',
  ];

  for (const prop of ALL_PROPERTIES) {
    if (!computed.has(prop)) {
      computed.set(prop, getInitialValue(prop));
    }
  }
}
