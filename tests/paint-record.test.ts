import { describe, it, expect } from "vitest";
import {
  buildRenderTree,
  DOMNodeType,
  type DOMNodeLike,
  type ComputedStyleLike,
} from "../src/browser/rendering/pipeline/render-tree";
import { buildLayoutTree, resolveBlockLayout, BoxType } from "../src/browser/rendering/pipeline/layout-box";
import {
  buildPaintRecords,
  PaintCommandKind,
  countCommandsByKind,
  type DrawTextCommand,
  type FillRectCommand,
} from "../src/browser/rendering/pipeline/paint-record";

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

function layout(root: DOMNodeLike, resolveStyle: (n: DOMNodeLike) => ComputedStyleLike, width = 800) {
  const renderTree = buildRenderTree(root, resolveStyle)!;
  const layoutTree = buildLayoutTree(renderTree);
  resolveBlockLayout(layoutTree, { containingBlockWidth: width });
  return layoutTree;
}

describe("cross-file audit: full render-tree -> layout-box -> text-shaping -> paint-record pipeline", () => {
  it("produces DrawText commands with correct absolute positions for simple text", () => {
    const root = el("div", [text("hello")]);
    const layoutTree = layout(root, styleMap(new Map()));
    const commands = buildPaintRecords(layoutTree);

    const textCmds = commands.filter(
      (c): c is DrawTextCommand => c.kind === PaintCommandKind.DrawText,
    );
    expect(textCmds).toHaveLength(1);
    expect(textCmds[0]!.text).toBe("hello");
    expect(textCmds[0]!.x).toBe(0);
    expect(textCmds[0]!.y).toBeGreaterThan(0); // baseline, not top
  });

  it("paints background+border for a styled box before its children (painter's algorithm order)", () => {
    const child = el("div", [text("inner")]);
    const root = el("div", [child]);
    const layoutTree = layout(
      root,
      (n) =>
        (n === root
          ? { ...baseStyle, backgroundColor: "#ff0000" }
          : baseStyle) as ComputedStyleLike,
    );
    const commands = buildPaintRecords(layoutTree);

    const fillIndex = commands.findIndex((c) => c.kind === PaintCommandKind.FillRect);
    const textIndex = commands.findIndex((c) => c.kind === PaintCommandKind.DrawText);
    expect(fillIndex).toBeGreaterThanOrEqual(0);
    expect(textIndex).toBeGreaterThanOrEqual(0);
    expect(fillIndex).toBeLessThan(textIndex);
  });

  it("correctly positions an inline-block's nested content in the display list (depends on session-3's subtree translation fix)", () => {
    const grandchildText = text("nested");
    const innerDiv = el("div", [grandchildText]);
    const ib = el("span", [innerDiv]);
    const root = el("div", [text("leading word "), ib]);

    const layoutTree = layout(
      root,
      styleMap(new Map([[ib, { display: "inline-block", width: 120 } as Partial<ComputedStyleLike>]])),
    );
    const commands = buildPaintRecords(layoutTree);

    const textCmds = commands.filter(
      (c): c is DrawTextCommand => c.kind === PaintCommandKind.DrawText,
    );
    const nestedCmd = textCmds.find((c) => c.text === "nested");
    const leadingCmd = textCmds.find((c) => c.text === "leading");

    expect(nestedCmd).toBeDefined();
    expect(leadingCmd).toBeDefined();
    // The nested text must paint to the right of the leading word, not at
    // x=0 (which is what it would be if the session-3 translation bug
    // were still present).
    expect(nestedCmd!.x).toBeGreaterThan(leadingCmd!.x);
  });

  it("skips visibility:hidden subtrees but still renders their siblings", () => {
    const hidden = el("div", [text("invisible")]);
    const visible = el("div", [text("visible")]);
    const root = el("div", [hidden, visible]);
    const layoutTree = layout(
      root,
      styleMap(new Map([[hidden, { visibility: "hidden" }]])),
    );
    const commands = buildPaintRecords(layoutTree);
    const texts = commands
      .filter((c): c is DrawTextCommand => c.kind === PaintCommandKind.DrawText)
      .map((c) => c.text);
    expect(texts).toEqual(["visible"]);
  });

  it("skips opacity:0 boxes", () => {
    const invisible = el("div", [text("gone")]);
    const root = el("div", [invisible]);
    const layoutTree = layout(root, styleMap(new Map([[invisible, { opacity: 0 }]])));
    const commands = buildPaintRecords(layoutTree);
    expect(commands.some((c) => c.kind === PaintCommandKind.DrawText)).toBe(false);
  });

  it("emits a DrawImagePlaceholder for replaced elements and does not recurse into their (ignored) children", () => {
    const img = el("img", [text("alt text, should not become a DrawText")]);
    const root = el("div", [img]);
    const layoutTree = layout(root, styleMap(new Map()));
    const commands = buildPaintRecords(layoutTree);

    expect(commands.some((c) => c.kind === PaintCommandKind.DrawImagePlaceholder)).toBe(true);
    expect(commands.some((c) => c.kind === PaintCommandKind.DrawText)).toBe(false);
  });
});

describe("buildPaintRecords — background and border", () => {
  it("does not emit a FillRect for transparent (default) background", () => {
    const root = el("div");
    const layoutTree = layout(root, styleMap(new Map()));
    const commands = buildPaintRecords(layoutTree);
    expect(commands.some((c) => c.kind === PaintCommandKind.FillRect)).toBe(false);
  });

  it("emits exactly one FillRect using the border-box rect for a solid background", () => {
    const root = el("div");
    const layoutTree = layout(
      root,
      (n) =>
        ({
          ...baseStyle,
          backgroundColor: "#00ff00",
          paddingTop: 5,
          paddingLeft: 5,
          borderTopWidth: 2,
          borderLeftWidth: 2,
        } as ComputedStyleLike),
    );
    const commands = buildPaintRecords(layoutTree);
    const fills = commands.filter((c): c is FillRectCommand => c.kind === PaintCommandKind.FillRect);
    expect(fills).toHaveLength(1);
    expect(fills[0]!.color).toBe("#00ff00");
  });

  it("emits one StrokeRect per non-zero border edge, none for zero-width edges", () => {
    const root = el("div");
    const layoutTree = layout(
      root,
      (n) =>
        ({
          ...baseStyle,
          borderTopWidth: 1,
          borderTopColor: "#111111",
          borderBottomWidth: 0,
        } as ComputedStyleLike),
    );
    const commands = buildPaintRecords(layoutTree);
    const strokes = commands.filter((c) => c.kind === PaintCommandKind.StrokeRect);
    expect(strokes).toHaveLength(1);
    expect((strokes[0] as any).edge).toBe("top");
  });
});

describe("countCommandsByKind", () => {
  it("tallies command kinds including zero-count kinds", () => {
    const root = el("div", [text("x")]);
    const layoutTree = layout(root, styleMap(new Map()));
    const commands = buildPaintRecords(layoutTree);
    const counts = countCommandsByKind(commands);
    expect(counts[PaintCommandKind.DrawText]).toBe(1);
    expect(counts[PaintCommandKind.FillRect]).toBe(0);
  });
});
