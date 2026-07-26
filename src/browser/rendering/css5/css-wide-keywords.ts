/**
 * @file css5/css-wide-keywords.ts
 * CSS-wide keyword resolution — `inherit`, `initial`, `unset`, `revert`.
 *
 * These keywords can appear as the value of any CSS property and have
 * special semantics defined in CSS Cascading Level 5:
 *
 *   inherit    — Use the parent's computed value.
 *   initial    — Use the property's defined initial value.
 *   unset      — If inherited → inherit; otherwise → initial.
 *   revert     — Roll back to the previous cascade origin's value.
 *   revert-layer — Roll back to the previous @layer's value.
 *
 * Processing happens after cascade sorting and before inheritance/initial
 * values are applied, so these keywords can override any cascade entry.
 */

import { isInheritedProperty, getInitialValue } from './property-definitions';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface KeywordContext {
  /** Parent element's computed style map (for `inherit`). */
  readonly parentComputed: ReadonlyMap<string, string> | null;
  /** UA default declarations for this element (for `revert` fallback). */
  readonly uaDefaults: ReadonlyMap<string, string>;
  /** Default initial value when property is unknown. */
  readonly fallbackInitial?: string;
  /** Current cascade entries (for revert/revert-layer origin tracking). */
  readonly cascadeEntries?: ReadonlyArray<{
    property: string;
    value: string;
    important: boolean;
    layerIndex: number;
    layerName: string | null;
    sourceOrder: number;
  }>;
  /** Layer order array (for revert-layer). */
  readonly layerOrder?: readonly string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS-WIDE KEYWORD DETECTION
// ─────────────────────────────────────────────────────────────────────────────

const CSS_WIDE_KEYWORDS = new Set([
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
]);

/**
 * Returns true if `value` is a CSS-wide keyword (case-insensitive).
 */
export function isCSSWideKeywordValue(value: string): boolean {
  return CSS_WIDE_KEYWORDS.has(value.trim().toLowerCase());
}

/**
 * Extracts the normalized CSS-wide keyword from a value, or null if none.
 */
export function extractCSSWideKeyword(value: string): 'inherit' | 'initial' | 'unset' | 'revert' | 'revert-layer' | null {
  const v = value.trim().toLowerCase();
  if (v === 'inherit') return 'inherit';
  if (v === 'initial') return 'initial';
  if (v === 'unset') return 'unset';
  if (v === 'revert') return 'revert';
  if (v === 'revert-layer') return 'revert-layer';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// KEYWORD RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves a CSS-wide keyword for a given property.
 *
 * Returns the resolved string value, or the original value unchanged
 * if it is not a CSS-wide keyword.
 *
 * @param property  - CSS property name (e.g. 'color', 'margin-top')
 * @param value     - Declared value (may contain a CSS-wide keyword)
 * @param context   - Resolution context (parent computed, UA defaults)
 * @returns         - Resolved value or the original `value` if not a keyword
 */
export function resolveCSSWideKeyword(
  property: string,
  value: string,
  context: KeywordContext,
): string {
  const keyword = extractCSSWideKeyword(value);
  if (!keyword) return value;

  switch (keyword) {
    case 'inherit':
      return resolveInherit(property, context);
    case 'initial':
      return getInitialValue(property);
    case 'unset':
      return resolveUnset(property, context);
    case 'revert':
      return resolveRevert(property, context);
    case 'revert-layer':
      return resolveRevertLayer(property, context);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INDIVIDUAL KEYWORD HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `inherit` — Use the parent's computed value.
 * Falls back to initial value if no parent exists (root element).
 */
function resolveInherit(
  property: string,
  context: KeywordContext,
): string {
  if (context.parentComputed) {
    const parentValue = context.parentComputed.get(property);
    if (parentValue !== undefined) return parentValue;
  }
  // Root element: inherit behaves like initial
  return getInitialValue(property);
}

/**
 * `unset` — If inherited → inherit; otherwise → initial.
 */
function resolveUnset(
  property: string,
  context: KeywordContext,
): string {
  if (isInheritedProperty(property)) {
    return resolveInherit(property, context);
  }
  return getInitialValue(property);
}

/**
 * `revert` — Roll back to the previous cascade origin.
 *
 * In a browser context, origins are:
 *   1. Transition (highest priority)
 *   2. Author !important
 *   3. Author normal
 *   4. User !important
 *   5. User normal
 *   6. User-agent (lowest priority)
 *
 * Since Nova doesn't track per-origin cascade entries, `revert` behaves
 * like `unset` for author-origin rules (falling back to UA defaults),
 * which is the most common real-world use case.
 */
function resolveRevert(
  property: string,
  context: KeywordContext,
): string {
  // Try UA defaults first (represents the "user-agent" origin)
  const uaValue = context.uaDefaults.get(property);
  if (uaValue !== undefined) return uaValue;

  // Then fall back to unset behavior
  return resolveUnset(property, context);
}

/**
 * `revert-layer` — Roll back to the value from the previous @layer.
 *
 * In the cascade, declarations are sorted by layer index.
 * For a given property, find the entry with the next-lower layer index
 * (or unlayered, i.e. layerIndex = -1) and use its value.
 * If no previous layer exists, falls back to UA defaults.
 */
function resolveRevertLayer(
  property: string,
  context: KeywordContext,
): string {
  if (!context.cascadeEntries || !context.layerOrder) {
    return resolveRevert(property, context);
  }

  // Find entries for this property, sorted by layerIndex ascending
  const entries = context.cascadeEntries
    .filter(e => e.property === property)
    .sort((a, b) => a.layerIndex - b.layerIndex);

  if (entries.length <= 1) {
    // Only one entry (the current one using revert-layer), fall back to UA
    return resolveRevert(property, context);
  }

  // The current entry is the last one (highest layer index).
  // Use the second-to-last entry's value (previous layer).
  const current = entries[entries.length - 1]!;
  const previous = entries[entries.length - 2]!;

  // If previous is unlayered (layerIndex === -1), use it
  // If previous is in a different layer, use it
  if (previous.layerIndex !== current.layerIndex) {
    return previous.value;
  }

  // Same layer — fall back to UA defaults
  return resolveRevert(property, context);
}

// ─────────────────────────────────────────────────────────────────────────────
// BATCH PROCESSING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Processes CSS-wide keywords for all properties in a computed style map.
 * Mutates the map in place.
 *
 * @param computed      - Computed style map to process
 * @param context       - Resolution context
 * @returns             - The same map (mutated)
 */
export function processCSSWideKeywords(
  computed: Map<string, string>,
  context: KeywordContext,
): Map<string, string> {
  for (const [prop, value] of computed) {
    // Custom properties (--*) store raw token values — skip them.
    if (prop.startsWith('--')) continue;
    if (isCSSWideKeywordValue(value)) {
      computed.set(prop, resolveCSSWideKeyword(prop, value, context));
    }
  }
  return computed;
}
