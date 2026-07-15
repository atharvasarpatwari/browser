import type { DomElement, DomNode, LayoutBox } from '../dom-tree';

// ─────────────────────────────────────────────────────────────────────────────
// FORMATTING CONTEXT TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** What kind of formatting context an element establishes. */
export type FormattingContextType =
  | 'block'
  | 'inline'
  | 'inline-block'
  | 'flex'
  | 'inline-flex'
  | 'grid'
  | 'inline-grid'
  | 'none';

/** Classifies a display value into its formatting role. */
export function classifyDisplay(display: string): FormattingContextType {
  switch (display) {
    case 'none':
      return 'none';
    case 'flex':
      return 'flex';
    case 'inline-flex':
      return 'inline-flex';
    case 'grid':
      return 'grid';
    case 'inline-grid':
      return 'inline-grid';
    case 'block':
    case 'table':
    case 'table-row':
    case 'table-cell':
    case 'list-item':
    case 'flow-root':
      return 'block';
    case 'inline-block':
      return 'inline-block';
    default:
      return 'inline';
  }
}

/** Whether an element is block-level (establishes a BFC or participates in one as a block). */
export function isBlockLevel(display: string): boolean {
  switch (display) {
    case 'block':
    case 'flex':
    case 'grid':
    case 'table':
    case 'table-row':
    case 'table-cell':
    case 'list-item':
    case 'flow-root':
    case 'inline-block':
    case 'inline-flex':
    case 'inline-grid':
      return true;
    default:
      return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LINE BOX (for inline formatting context)
// ─────────────────────────────────────────────────────────────────────────────

/** An inline-level box that sits inside a line box. */
export interface InlineLevelBox {
  /** The DOM element (for real elements) or null (for anonymous text runs). */
  element: DomElement | null;
  /** The computed box model for this inline-level box. */
  box: LayoutBox;
  /** The baseline offset from the top of the line box. */
  baselineOffset: number;
  /** Whether this is an anonymous text run (no backing DOM element). */
  isAnonymous: boolean;
  /** The text content for anonymous text runs. */
  textContent?: string;
}

/** A single line box within an inline formatting context.**
 * Contains inline-level boxes laid out horizontally. */
export interface LineBox {
  /** Y position of the top of this line box. */
  y: number;
  /** Height of this line box (distance between baselines or strut height). */
  height: number;
  /** Width consumed so far on this line. */
  usedWidth: number;
  /** The baseline Y position (relative to the line box top). */
  baseline: number;
  /** Inline-level boxes on this line. */
  boxes: InlineLevelBox[];
}

// ─────────────────────────────────────────────────────────────────────────────
// RESOLVED BOX MODEL (passed around during layout)
// ─────────────────────────────────────────────────────────────────────────────

/** A fully resolved box model for a single element, ready for positioning. */
export interface ResolvedBox {
  readonly marginTop: number;
  readonly marginRight: number;
  readonly marginBottom: number;
  readonly marginLeft: number;
  readonly paddingTop: number;
  readonly paddingRight: number;
  readonly paddingBottom: number;
  readonly paddingLeft: number;
  readonly borderTop: number;
  readonly borderRight: number;
  readonly borderBottom: number;
  readonly borderLeft: number;
  readonly borderWidthBox: number;
  readonly contentWidth: number;
  readonly boxSizing: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CHILD CLASSIFICATION (for anonymous box generation)
// ─────────────────────────────────────────────────────────────────────────────

/** A classified child node, used during anonymous box generation. */
export interface ClassifiedChild {
  node: DomNode;
  display: string;
  isBlock: boolean;
}
