/**
 * text-shaping.ts
 * ---------------
 * Rendering layer — Session 3 of 9 (render-tree → layout-box → text-shaping →
 * paint-record → stacking-context → compositor → rasterizer →
 * repaint-scheduler → render-devtools-bridge).
 *
 * Resolves the TODO left in layout-box.ts session 2: inline-level content
 * (text runs, <span>-style inline boxes, inline-block boxes) was stacked as
 * zero-height placeholders. This module performs line breaking + glyph
 * measurement to produce real LineBox geometry, and layout-box.ts is
 * updated (see bottom of this file's companion diff) to call into it.
 *
 * Scope: a single inline formatting context per call (i.e. the children of
 * one block/anonymous-block container). Bidi, ligatures, kerning, and
 * hyphenation are out of scope — glyph advances come from a pluggable
 * FontMetricsProvider so a real font-shaping backend (HarfBuzz-style) can
 * be swapped in later without changing the line-breaking algorithm.
 */

import {
  BoxType,
  type LayoutBox,
  type Rect,
} from "./layout-box";
import type { ComputedStyleLike } from "./render-tree";

// ---------------------------------------------------------------------------
// Font metrics
// ---------------------------------------------------------------------------

export interface FontMetrics {
  readonly ascent: number;
  readonly descent: number;
  readonly lineHeight: number;
}

export interface FontMetricsProvider {
  /** Advance width, in pixels, of a single character at the given style. */
  measureChar(ch: string, style: ComputedStyleLike): number;
  /** Vertical metrics for a given style (used for line-box height/baseline). */
  metricsFor(style: ComputedStyleLike): FontMetrics;
}

interface FontStyleLike {
  readonly fontSize?: unknown;
  readonly lineHeight?: unknown;
}

const DEFAULT_FONT_SIZE = 16;

function readFontSize(style: ComputedStyleLike): number {
  const v = (style as unknown as FontStyleLike).fontSize;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : DEFAULT_FONT_SIZE;
}

function readLineHeight(style: ComputedStyleLike, fontSize: number): number {
  const v = (style as unknown as FontStyleLike).lineHeight;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  return fontSize * 1.2; // CSS "normal" approximation
}

/**
 * Naive deterministic metrics provider: no real font/glyph data is
 * available yet, so character advances are approximated by character
 * class (narrow / normal / wide) scaled to font-size. This keeps line
 * breaking behavior stable and testable while remaining a drop-in
 * replacement target once a real shaping backend exists — callers only
 * depend on the FontMetricsProvider interface above.
 */
export class HeuristicFontMetricsProvider implements FontMetricsProvider {
  measureChar(ch: string, style: ComputedStyleLike): number {
    const fontSize = readFontSize(style);
    if (ch === " " || ch === "\t") return fontSize * 0.28;
    if (/[iIl.,'!|]/.test(ch)) return fontSize * 0.28;
    if (/[mMWw@]/.test(ch)) return fontSize * 0.83;
    if (/[A-Z]/.test(ch)) return fontSize * 0.68;
    if (/[0-9]/.test(ch)) return fontSize * 0.55;
    return fontSize * 0.5;
  }

  metricsFor(style: ComputedStyleLike): FontMetrics {
    const fontSize = readFontSize(style);
    const lineHeight = readLineHeight(style, fontSize);
    return {
      ascent: fontSize * 0.8,
      descent: fontSize * 0.2,
      lineHeight,
    };
  }
}

export function measureText(
  text: string,
  style: ComputedStyleLike,
  provider: FontMetricsProvider,
): number {
  let width = 0;
  for (const ch of text) {
    width += provider.measureChar(ch, style);
  }
  return width;
}

// ---------------------------------------------------------------------------
// Inline item flattening
// ---------------------------------------------------------------------------

/**
 * A single word-or-whitespace-run token, ready for line-breaking. Splitting
 * a TextRun box into tokens at whitespace boundaries is what gives us soft
 * wrap points; the whitespace itself is folded into the *preceding* token's
 * trailing width so it collapses naturally at line ends.
 */
interface InlineToken {
  readonly kind: "text" | "atom";
  readonly sourceBox: LayoutBox;
  /** For kind "text": the literal characters this token renders. */
  readonly text: string;
  readonly width: number;
  readonly hasTrailingBreakOpportunity: boolean;
}

const WHITESPACE_RUN = /\s+/g;

function tokenizeTextRun(
  box: LayoutBox,
  style: ComputedStyleLike,
  provider: FontMetricsProvider,
): InlineToken[] {
  const raw = box.renderNode?.domNode.textContent ?? "";
  // Collapse internal whitespace runs to a single space (CSS white-space:
  // normal behavior — the common case; pre/pre-wrap is a documented
  // follow-up).
  const collapsed = raw.replace(WHITESPACE_RUN, " ").replace(/^\s+/, (m) => m.length ? " " : m);
  if (collapsed.length === 0) return [];

  const words = collapsed.split(" ");
  const tokens: InlineToken[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const isLast = i === words.length - 1;
    if (word.length > 0) {
      tokens.push({
        kind: "text",
        sourceBox: box,
        text: word,
        width: measureText(word, style, provider),
        hasTrailingBreakOpportunity: !isLast,
      });
    } else if (!isLast) {
      // Leading/consecutive space produced an empty split segment; treat
      // as an explicit break opportunity with zero width of its own (the
      // space width is spent as inter-word gap, added at line-build time).
      tokens.push({
        kind: "text",
        sourceBox: box,
        text: "",
        width: 0,
        hasTrailingBreakOpportunity: true,
      });
    }
  }
  return tokens;
}

/**
 * Flattens a container's inline-level subtree into a flat token stream.
 * Recurses into BoxType.Inline (e.g. <span>) since inline boxes don't
 * establish their own block/line context — their children flow into the
 * same lines as their siblings. InlineBlock and Replaced boxes are atomic
 * (single indivisible token, own already-resolved width).
 */
function flattenInlineItems(
  container: LayoutBox,
  provider: FontMetricsProvider,
): InlineToken[] {
  const tokens: InlineToken[] = [];
  for (const child of container.children) {
    collectTokens(child, provider, tokens);
  }
  return tokens;
}

function collectTokens(
  box: LayoutBox,
  provider: FontMetricsProvider,
  out: InlineToken[],
): void {
  switch (box.type) {
    case BoxType.TextRun:
      out.push(...tokenizeTextRun(box, box.style, provider));
      return;
    case BoxType.Inline:
      for (const child of box.children) {
        collectTokens(child, provider, out);
      }
      return;
    case BoxType.InlineBlock:
    case BoxType.Replaced: {
      // layout-box.ts's resolveInlineAtomSizes runs before this flatten
      // step and guarantees contentRect is populated for both box types —
      // see LayoutBox.inlineLayout doc comment in layout-box.ts.
      const width = Number.isFinite(box.contentRect.width) ? box.contentRect.width : 0;
      out.push({
        kind: "atom",
        sourceBox: box,
        text: "",
        width,
        hasTrailingBreakOpportunity: true,
      });
      return;
    }
    default:
      // Block-level content shouldn't appear here (layout-box.ts's
      // anonymous-block wrapping guarantees homogeneity) — ignore
      // defensively rather than throw, so a future box-generation change
      // degrades gracefully instead of crashing layout.
      return;
  }
}

// ---------------------------------------------------------------------------
// Line breaking
// ---------------------------------------------------------------------------

export interface LineFragment {
  readonly box: LayoutBox;
  readonly text: string;
  readonly rect: Rect;
  readonly baseline: number;
}

export interface LineBox {
  readonly rect: Rect;
  readonly baseline: number;
  readonly fragments: readonly LineFragment[];
}

export interface InlineLayoutResult {
  readonly lineBoxes: readonly LineBox[];
  readonly totalHeight: number;
}

/**
 * Greedy line-breaking algorithm (equivalent to CSS's default,
 * non-hyphenated wrapping): pack tokens onto a line until the next token
 * would overflow the available width, then start a new line. A single
 * token wider than the available width is placed alone on its own line
 * rather than looping forever.
 */
export function layoutInlineContent(
  container: LayoutBox,
  availableWidth: number,
  originX: number,
  originY: number,
  provider: FontMetricsProvider = new HeuristicFontMetricsProvider(),
): InlineLayoutResult {
  const tokens = flattenInlineItems(container, provider);
  const spaceWidth = measureText(" ", container.style, provider);

  const lineBoxes: LineBox[] = [];
  let cursorY = originY;
  let lineTokens: InlineToken[] = [];
  let lineWidth = 0;

  const flushLine = () => {
    if (lineTokens.length === 0) return;
    const metrics = lineMetrics(lineTokens, provider);
    const rect: Rect = {
      x: originX,
      y: cursorY,
      width: Math.max(lineWidth, 0),
      height: metrics.lineHeight,
    };
    const baseline = cursorY + metrics.ascent;

    const fragments: LineFragment[] = [];
    let cursorX = originX;
    for (const token of lineTokens) {
      const tokenMetrics = provider.metricsFor(token.sourceBox.style);
      fragments.push({
        box: token.sourceBox,
        text: token.text,
        rect: { x: cursorX, y: cursorY, width: token.width, height: tokenMetrics.lineHeight },
        baseline: cursorY + tokenMetrics.ascent,
      });
      cursorX += token.width + (token.hasTrailingBreakOpportunity ? spaceWidth : 0);
    }

    lineBoxes.push({ rect, baseline, fragments });
    cursorY += metrics.lineHeight;
    lineTokens = [];
    lineWidth = 0;
  };

  for (const token of tokens) {
    if (token.text === "" && token.width === 0 && lineTokens.length === 0) {
      // Skip pure break-opportunity tokens at the start of a line (leading
      // collapsible whitespace at a wrap point).
      continue;
    }

    const additionalWidth =
      token.width + (lineTokens.length > 0 ? spaceWidth : 0);
    const wouldOverflow = lineWidth + additionalWidth > availableWidth;

    if (wouldOverflow && lineTokens.length > 0) {
      flushLine();
      lineTokens.push(token);
      lineWidth = token.width;
    } else {
      lineTokens.push(token);
      lineWidth += additionalWidth;
    }
  }
  flushLine();

  return { lineBoxes, totalHeight: cursorY - originY };
}

function lineMetrics(tokens: readonly InlineToken[], provider: FontMetricsProvider): FontMetrics {
  let ascent = 0;
  let descent = 0;
  let lineHeight = 0;
  for (const token of tokens) {
    const m = provider.metricsFor(token.sourceBox.style);
    ascent = Math.max(ascent, m.ascent);
    descent = Math.max(descent, m.descent);
    lineHeight = Math.max(lineHeight, m.lineHeight);
  }
  if (tokens.length === 0) {
    return { ascent: 0, descent: 0, lineHeight: 0 };
  }
  return { ascent, descent, lineHeight };
}
