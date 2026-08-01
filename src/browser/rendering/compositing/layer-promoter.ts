/**
 * @file LayerPromoter — Conservative layer promotion heuristics.
 *
 * Analyzes stacking contexts and determines which should be promoted to
 * independent compositing layers. Conservative approach: only promote when
 * there's a clear CSS hint (will-change, transform, opacity, filter, isolation).
 */

import type { DomElement } from '../dom-tree';
import type { StackingContext } from '../formatting/stacking';
import type { ViewportRect } from './tile-grid';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface PromotionHint {
  readonly willChange: string | null;
  readonly hasTransform: boolean;
  readonly hasOpacityLessThan1: boolean;
  readonly hasFilter: boolean;
  readonly hasIsolation: boolean;
  readonly isLargeElement: boolean;
  readonly shouldPromote: boolean;
  readonly reason: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER PROMOTER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determines which stacking contexts should be promoted to compositing layers.
 *
 * Conservative heuristics:
 * 1. will-change: transform, opacity, paint → always promote
 * 2. transform != none → always promote
 * 3. opacity < 1 → always promote (group compositing)
 * 4. filter != none → always promote
 * 5. isolation: isolate → always promote
 * 6. Large element (>512px in any dimension) → promote for tiling
 */
export class LayerPromoter {
  private largeElementThreshold: number;

  constructor(largeElementThreshold: number = 512) {
    this.largeElementThreshold = largeElementThreshold;
  }

  /**
   * Analyze a stacking context and determine if it should be promoted.
   */
  shouldPromote(ctx: StackingContext, _viewport?: ViewportRect): boolean {
    return this.getHint(ctx).shouldPromote;
  }

  /**
   * Get detailed promotion hint for a stacking context.
   */
  getHint(ctx: StackingContext): PromotionHint {
    const el = ctx.element;
    const style = el.computedStyle ?? new Map();

    const willChange = style.get('will-change') ?? null;
    const hasTransform = !!(style.get('transform') && style.get('transform') !== 'none');
    const hasOpacityLessThan1 = ctx.isGrouped;
    const hasFilter = !!(style.get('filter') && style.get('filter') !== 'none');
    const hasIsolation = style.get('isolation') === 'isolate';

    const box = el.layoutBox;
    const isLargeElement = !!(
      box && (box.width > this.largeElementThreshold || box.height > this.largeElementThreshold)
    );

    // Check will-change properties
    let hasWillChangeHint = false;
    if (willChange) {
      const props = willChange.split(',').map((s: string) => s.trim().toLowerCase());
      hasWillChangeHint = (
        props.includes('transform') ||
        props.includes('opacity') ||
        props.includes('paint') ||
        props.includes('contents')
      );
    }

    // Determine promotion
    let shouldPromote = false;
    let reason = '';

    if (hasWillChangeHint) {
      shouldPromote = true;
      reason = `will-change: ${willChange}`;
    } else if (hasTransform) {
      shouldPromote = true;
      reason = 'transform';
    } else if (hasOpacityLessThan1) {
      shouldPromote = true;
      reason = 'opacity < 1';
    } else if (hasFilter) {
      shouldPromote = true;
      reason = 'filter';
    } else if (hasIsolation) {
      shouldPromote = true;
      reason = 'isolation: isolate';
    } else if (isLargeElement) {
      shouldPromote = true;
      reason = 'large element (tiling)';
    }

    return {
      willChange,
      hasTransform,
      hasOpacityLessThan1,
      hasFilter,
      hasIsolation,
      isLargeElement,
      shouldPromote,
      reason,
    };
  }
}
