import { describe, it, expect } from "vitest";
import {
  buildRenderTree,
  DOMNodeType,
  type DOMNodeLike,
  type ComputedStyleLike,
} from "../src/browser/rendering/pipeline/render-tree";
import { buildLayoutTree, resolveBlockLayout, BoxType } from "../src/browser/rendering/pipeline/layout-box";
import {
  measureText,
  layoutInlineContent,
  HeuristicFontMetricsProvider,
} from "../src/browser/rendering/pipeline/text-shaping";

function el(name: string, children: DOMNodeLike[] = []): DOMNodeLike {
  return { nodeType: DOMNodeType.Element, nodeName: name, childNodes: children, textContent: null };
}
function text(t: string): DOMNodeLike {
  return { nodeType: DOMNodeType.Text, nodeName: "#text", childNodes: [], textContent: t };
}

const baseStyle: ComputedStyleLike = {
  display: "block",
  position: "static",
  zIndex: "auto",
  opacity: 1,
  visibility: "visible",
};

function styleMap(overrides: Map<DOMNodeLike, Partial<ComputedStyleLike>>) {
  return (node: DOMNodeLike): ComputedStyleLike => ({
    ...baseStyle,
    ...(overrides.get(node) ?? {}),
  });
}

const provider = new HeuristicFontMetricsProvider();

describe("measureText / HeuristicFontMetricsProvider", () => {
  it("returns positive, finite width for ordinary text", () => {
    const w = measureText("hello world", baseStyle, provider);
    expect(Number.isFinite(w)).toBe(true);
    expect(w).toBeGreaterThan(0);
  });

  it("scales with font-size", () => {
    const small = measureText("hello", { ...baseStyle, fontSize: 10 } as ComputedStyleLike, provider);
    const large = measureText("hello", { ...baseStyle, fontSize: 40 } as ComputedStyleLike, provider);
    expect(large).toBeGreaterThan(small);
  });

  it("empty string measures to zero", () => {
    expect(measureText("", baseStyle, provider)).toBe(0);
  });
});

describe("cross-file audit: render-tree -> layout-box -> text-shaping pipeline", () => {
  it("resolveBlockLayout now produces non-zero height for inline text content (session-2 TODO resolved)", () => {
    const root = el("div", [text("hello world this is a paragraph of text")]);
    const renderTree = buildRenderTree(root, styleMap(new Map()))!;
    const layoutTree = buildLayoutTree(renderTree);
    resolveBlockLayout(layoutTree, { containingBlockWidth: 400 });

    expect(layoutTree.contentRect.height).toBeGreaterThan(0);
    expect(layoutTree.inlineLayout).toBeDefined();
    expect(layoutTree.inlineLayout!.lineBoxes.length).toBeGreaterThan(0);
  });

  it("wraps long text into multiple line boxes at a narrow width", () => {
    const longText =
      "the quick brown fox jumps over the lazy dog and keeps running further still";
    const root = el("div", [text(longText)]);
    const renderTree = buildRenderTree(root, styleMap(new Map()))!;
    const layoutTree = buildLayoutTree(renderTree);
    resolveBlockLayout(layoutTree, { containingBlockWidth: 80 });

    expect(layoutTree.inlineLayout!.lineBoxes.length).toBeGreaterThan(1);
  });

  it("fits short text onto a single line at a wide width", () => {
    const root = el("div", [text("short line")]);
    const renderTree = buildRenderTree(root, styleMap(new Map()))!;
    const layoutTree = buildLayoutTree(renderTree);
    resolveBlockLayout(layoutTree, { containingBlockWidth: 2000 });

    expect(layoutTree.inlineLayout!.lineBoxes.length).toBe(1);
  });

  it("mixed block+inline content: anonymous block gets inlineLayout, sibling block box does not need it", () => {
    const inlineSpan = el("span", [text("inline text")]);
    const blockDiv = el("div");
    const root = el("div", [inlineSpan, blockDiv]);
    const renderTree = buildRenderTree(
      root,
      styleMap(new Map([[inlineSpan, { display: "inline" }]])),
    )!;
    const layoutTree = buildLayoutTree(renderTree);
    resolveBlockLayout(layoutTree, { containingBlockWidth: 400 });

    const anonBlock = layoutTree.children[0]!;
    expect(anonBlock.type).toBe(BoxType.Anonymous);
    expect(anonBlock.inlineLayout).toBeDefined();
    expect(anonBlock.contentRect.height).toBeGreaterThan(0);

    const blockBox = layoutTree.children[1]!;
    expect(blockBox.type).toBe(BoxType.Block);
    expect(blockBox.inlineLayout).toBeUndefined();
  });

  it("nested inline elements (span inside span) flow into the same line list", () => {
    const innerSpan = el("span", [text("inner")]);
    const outerSpan = el("span", [text("outer "), innerSpan]);
    const root = el("div", [outerSpan]);
    const renderTree = buildRenderTree(
      root,
      styleMap(new Map([[outerSpan, { display: "inline" }], [innerSpan, { display: "inline" }]])),
    )!;
    const layoutTree = buildLayoutTree(renderTree);
    resolveBlockLayout(layoutTree, { containingBlockWidth: 2000 });

    // Both text runs should land as fragments on the single line.
    const line = layoutTree.inlineLayout!.lineBoxes[0]!;
    const words = line.fragments.map((f) => f.text);
    expect(words).toContain("outer");
    expect(words).toContain("inner");
  });

  it("inline-block atoms are treated as indivisible width units in the flow", () => {
    const ib = el("span");
    const root = el("div", [ib]);
    const renderTree = buildRenderTree(
      root,
      styleMap(new Map([[ib, { display: "inline-block", width: 120 } as Partial<ComputedStyleLike>]])),
    )!;
    const layoutTree = buildLayoutTree(renderTree);
    resolveBlockLayout(layoutTree, { containingBlockWidth: 2000 });

    const line = layoutTree.inlineLayout!.lineBoxes[0]!;
    expect(line.fragments).toHaveLength(1);
    expect(line.fragments[0]!.rect.width).toBe(120);
  });

  it("shifts an inline-block's descendant subtree to its real line position, not the 0,0 pre-layout origin", () => {
    // Regression test: resolveInlineAtomSizes lays an inline-block's
    // subtree out at a temporary (0,0) origin before its real line
    // position is known. If the fix didn't propagate that shift to
    // descendants, the grandchild text below would stay stuck near x=0
    // even though the inline-block itself sits later in the line.
    const grandchildText = text("nested");
    const ibInnerBlock = el("div", [grandchildText]);
    const ib = el("span", [ibInnerBlock]);
    // Push the inline-block off the left edge with a preceding word so its
    // real line x-position is unambiguously greater than 0.
    const root = el("div", [text("leading word "), ib]);

    const renderTree = buildRenderTree(
      root,
      styleMap(new Map([[ib, { display: "inline-block", width: 120 } as Partial<ComputedStyleLike>]])),
    )!;
    const layoutTree = buildLayoutTree(renderTree);
    resolveBlockLayout(layoutTree, { containingBlockWidth: 2000 });

    const line = layoutTree.inlineLayout!.lineBoxes[0]!;
    const ibFragment = line.fragments.find((f) => f.box.type === BoxType.InlineBlock)!;
    expect(ibFragment.rect.x).toBeGreaterThan(0);

    // Walk down to the grandchild text box and confirm its absolute x
    // tracks the inline-block's real position, not 0.
    const ibBox = ibFragment.box;
    const innerDivBox = ibBox.children[0]!;
    const grandchildTextBox = innerDivBox.inlineLayout!.lineBoxes[0]!.fragments[0]!.box;
    expect(grandchildTextBox.contentRect.x).toBeGreaterThanOrEqual(ibFragment.rect.x);
  });
});

describe("layoutInlineContent — line breaking edge cases", () => {
  it("places a single token wider than availableWidth alone on its own line (no infinite loop)", () => {
    const root = el("div", [text("supercalifragilisticexpialidocious")]);
    const renderTree = buildRenderTree(root, styleMap(new Map()))!;
    const layoutTree = buildLayoutTree(renderTree);

    const result = layoutInlineContent(layoutTree, 10, 0, 0, provider);
    expect(result.lineBoxes.length).toBe(1);
    expect(result.lineBoxes[0]!.fragments).toHaveLength(1);
  });

  it("returns zero lines for a container with no inline children", () => {
    const root = el("div");
    const renderTree = buildRenderTree(root, styleMap(new Map()))!;
    const layoutTree = buildLayoutTree(renderTree);
    const result = layoutInlineContent(layoutTree, 400, 0, 0, provider);
    expect(result.lineBoxes).toHaveLength(0);
    expect(result.totalHeight).toBe(0);
  });

  it("collapses runs of internal whitespace into single-space gaps", () => {
    const root = el("div", [text("a    b")]);
    const renderTree = buildRenderTree(root, styleMap(new Map()))!;
    const layoutTree = buildLayoutTree(renderTree);
    const result = layoutInlineContent(layoutTree, 2000, 0, 0, provider);
    const words = result.lineBoxes[0]!.fragments.map((f) => f.text);
    expect(words).toEqual(["a", "b"]);
  });
});
