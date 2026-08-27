import { describe, it, expect } from "vitest";
import { PaintCommandKind } from "../src/browser/rendering/pipeline/paint-record";
import { rasterize, rasterizePlan } from "../src/browser/rendering/pipeline/rasterizer";
import { planCompositing } from "../src/browser/rendering/pipeline/compositor";
import { buildRenderTree, DOMNodeType, type DOMNodeLike, type ComputedStyleLike } from "../src/browser/rendering/pipeline/render-tree";
import { buildLayoutTree, resolveBlockLayout } from "../src/browser/rendering/pipeline/layout-box";
import { buildPaintRecords } from "../src/browser/rendering/pipeline/paint-record";
import { buildStackingTree } from "../src/browser/rendering/pipeline/stacking-context";

// --- tiny helpers -----------------------------------------------------------

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

/** Full pipeline 1→7 returning raster result. */
function pipelineRaster(
  dom: DOMNodeLike,
  resolver: (n: DOMNodeLike) => ComputedStyleLike,
  w: number,
  h: number,
): ReturnType<typeof rasterize> {
  const render = buildRenderTree(dom, resolver)!;
  const layoutTree = buildLayoutTree(render);
  resolveBlockLayout(layoutTree, { containingBlockWidth: w });
  const commands = buildPaintRecords(layoutTree);
  const stackTree = buildStackingTree(layoutTree, commands);
  const plan = planCompositing(stackTree);
  return rasterizePlan(plan, w, h);
}

/** Read the RGBA of a single pixel at (x, y) as a tuple. */
function pixel(pixels: Uint8ClampedArray, w: number, x: number, y: number): [number, number, number, number] {
  const idx = (y * w + x) * 4;
  return [pixels[idx]!, pixels[idx + 1]!, pixels[idx + 2]!, pixels[idx + 3]!];
}

// ---------------------------------------------------------------------------
// Empty / zero commands
// ---------------------------------------------------------------------------

describe("rasterizer — empty", () => {
  it("produces a transparent buffer when there are no commands", () => {
    const { pixels, width, height } = rasterize([], 4, 4);
    expect(width).toBe(4);
    expect(height).toBe(4);
    expect(pixels.length).toBe(4 * 4 * 4);
    // every pixel fully transparent
    for (let i = 3; i < pixels.length; i += 4) {
      expect(pixels[i]).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// FillRect — solid opaque
// ---------------------------------------------------------------------------

describe("rasterizer — FillRect opaque", () => {
  it("fills a solid red rect at exact pixel positions", () => {
    const cmd = {
      kind: PaintCommandKind.FillRect as const,
      rect: { x: 2, y: 2, width: 4, height: 3 },
      color: "#ff0000",
      sourceBox: null as never,
    };
    const { pixels } = rasterize([cmd], 10, 10);

    // inside rect: opaque red
    expect(pixel(pixels, 10, 3, 3)).toEqual([255, 0, 0, 255]);
    // outside rect: transparent
    expect(pixel(pixels, 10, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it("fills with full opacity from #rrggbb hex", () => {
    const cmd = {
      kind: PaintCommandKind.FillRect as const,
      rect: { x: 0, y: 0, width: 3, height: 3 },
      color: "#00ff00",
      sourceBox: null as never,
    };
    const { pixels } = rasterize([cmd], 5, 5);
    expect(pixel(pixels, 5, 1, 1)).toEqual([0, 255, 0, 255]);
  });
});

// ---------------------------------------------------------------------------
// FillRect — semi-transparent alpha
// ---------------------------------------------------------------------------

describe("rasterizer — FillRect alpha", () => {
  it("blends a semi-transparent blue onto a white background", () => {
    const bg = {
      kind: PaintCommandKind.FillRect as const,
      rect: { x: 0, y: 0, width: 10, height: 10 },
      color: "#ffffff",
      sourceBox: null as never,
    };
    const overlay = {
      kind: PaintCommandKind.FillRect as const,
      rect: { x: 0, y: 0, width: 10, height: 10 },
      color: "rgba(0, 0, 255, 0.5)",
      sourceBox: null as never,
    };
    const { pixels } = rasterize([bg, overlay], 10, 10);

    // source-over: dst(255,255,255,255) src(0,0,255,128)
    // outA = 0.5 + 1.0 * 0.5 = 1.0
    // R = (0*0.5 + 255*0.5) / 1.0 = 127.5 → 127 (round-half-to-even)
    const [r, g, b, a] = pixel(pixels, 10, 5, 5);
    expect(r).toBe(127);
    expect(g).toBe(127);
    expect(b).toBe(255);
    expect(a).toBe(255);
  });

  it("blends two semi-transparent rects onto empty canvas", () => {
    const cmdA = {
      kind: PaintCommandKind.FillRect as const,
      rect: { x: 0, y: 0, width: 4, height: 4 },
      color: "rgba(255, 0, 0, 0.5)",
      sourceBox: null as never,
    };
    const cmdB = {
      kind: PaintCommandKind.FillRect as const,
      rect: { x: 2, y: 2, width: 4, height: 4 },
      color: "rgba(0, 0, 255, 0.5)",
      sourceBox: null as never,
    };
    const { pixels } = rasterize([cmdA, cmdB], 6, 6);

    // Overlap region at (3,3): first red 50%, then blue 50% on top
    // After red: rgba(255,0,0,128) on empty (0,0,0,0)
    //   outA = 0.5; R=255, G=0, B=0
    // After blue on that: src(0,0,255,128) dst(255,0,0,128)
    //   srcA=0.5, dstA=0.5, outA=0.75
    //   R = (0*0.5 + 255*0.5*0.5) / 0.75 = 63.75/0.75 = 85
    //   B = (255*0.5 + 0*0.5*0.5) / 0.75 = 127.5/0.75 = 170
    const [r, g, bVal, alpha] = pixel(pixels, 6, 3, 3);
    expect(r).toBe(85);
    expect(g).toBe(0);
    expect(bVal).toBe(170);
    expect(alpha).toBe(192); // 0.75 * 255 = 191.25 → 191, but rounding varies — check close
  });
});

// ---------------------------------------------------------------------------
// StrokeRect
// ---------------------------------------------------------------------------

describe("rasterizer — StrokeRect", () => {
  it("fills the stroke-rect area with the specified colour", () => {
    const cmd = {
      kind: PaintCommandKind.StrokeRect as const,
      rect: { x: 1, y: 1, width: 5, height: 5 },
      color: "#0000ff",
      edge: "top" as const,
      sourceBox: null as never,
    };
    const { pixels } = rasterize([cmd], 10, 10);
    expect(pixel(pixels, 10, 2, 2)).toEqual([0, 0, 255, 255]);
    expect(pixel(pixels, 10, 0, 0)).toEqual([0, 0, 0, 0]);
  });
});

// ---------------------------------------------------------------------------
// DrawText placeholder
// ---------------------------------------------------------------------------

describe("rasterizer — DrawText placeholder", () => {
  it("renders a solid rectangle the size of estimated text bounds", () => {
    const cmd = {
      kind: PaintCommandKind.DrawText as const,
      text: "Hi",
      x: 10,
      y: 26,
      color: "#ff00ff",
      fontSize: 16,
      sourceBox: null as never,
    };
    const { pixels } = rasterize([cmd], 80, 50);

    // Estimated box: width = 2*16*0.6 = 19.2, height = 16*1.2 = 19.2
    // y origin = baseline - fontSize = 26 - 16 = 10
    // pixel (15, 15) should be inside the text rect
    expect(pixel(pixels, 80, 15, 15)).toEqual([255, 0, 255, 255]);
    // pixel (0, 0) outside
    expect(pixel(pixels, 80, 0, 0)).toEqual([0, 0, 0, 0]);
  });
});

// ---------------------------------------------------------------------------
// DrawImagePlaceholder — checker pattern
// ---------------------------------------------------------------------------

describe("rasterizer — DrawImagePlaceholder checker", () => {
  it("produces an alternating grey checker pattern", () => {
    const cmd = {
      kind: PaintCommandKind.DrawImagePlaceholder as const,
      rect: { x: 0, y: 0, width: 8, height: 8 },
      sourceBox: null as never,
    };
    const { pixels } = rasterize([cmd], 10, 10);

    // (0,0): isLight = ((0>>2)+(0>>2))%2 = 0 → grey=204
    expect(pixel(pixels, 10, 0, 0)).toEqual([204, 204, 204, 255]);
    // (4,0): isLight = ((1)+(0))%2 = 1 → grey=153
    expect(pixel(pixels, 10, 4, 0)).toEqual([153, 153, 153, 255]);
    // (4,4): isLight = ((1)+(1))%2 = 0 → grey=204
    expect(pixel(pixels, 10, 4, 4)).toEqual([204, 204, 204, 255]);
  });
});

// ---------------------------------------------------------------------------
// Offset / viewport translate
// ---------------------------------------------------------------------------

describe("rasterizer — viewport offset", () => {
  it("shifts all commands by (offsetX, offsetY)", () => {
    const cmd = {
      kind: PaintCommandKind.FillRect as const,
      rect: { x: 0, y: 0, width: 5, height: 5 },
      color: "#ff0000",
      sourceBox: null as never,
    };
    const { pixels } = rasterize([cmd], 10, 10, { offsetX: 3, offsetY: 2 });

    // Originally at (0,0); shifted to (3,2)
    expect(pixel(pixels, 10, 3, 2)).toEqual([255, 0, 0, 255]);
    expect(pixel(pixels, 10, 0, 0)).toEqual([0, 0, 0, 0]);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("rasterizer — determinism", () => {
  it("produces identical pixel buffers for the same input", () => {
    const cmds = [
      { kind: PaintCommandKind.FillRect as const, rect: { x: 5, y: 5, width: 10, height: 10 }, color: "#00ff00", sourceBox: null as never },
      { kind: PaintCommandKind.DrawText as const, text: "test", x: 20, y: 40, color: "#ff0000", fontSize: 20, sourceBox: null as never },
    ];
    const a = rasterize(cmds, 100, 100);
    const b = rasterize(cmds, 100, 100);
    expect(a.pixels).toEqual(b.pixels);
  });
});

// ---------------------------------------------------------------------------
// Clipping — commands outside buffer
// ---------------------------------------------------------------------------

describe("rasterizer — clipping", () => {
  it("does not corrupt pixels outside the buffer when a rect extends past the edge", () => {
    const cmd = {
      kind: PaintCommandKind.FillRect as const,
      rect: { x: 8, y: 8, width: 10, height: 10 },
      color: "#ff0000",
      sourceBox: null as never,
    };
    const { pixels } = rasterize([cmd], 10, 10);

    // (9, 9) is inside buffer and inside the clipped rect
    expect(pixel(pixels, 10, 9, 9)).toEqual([255, 0, 0, 255]);
    // (0, 0) is untouched
    expect(pixel(pixels, 10, 0, 0)).toEqual([0, 0, 0, 0]);
    // buffer length is correct
    expect(pixels.length).toBe(10 * 10 * 4);
  });
});

// ---------------------------------------------------------------------------
// Named colours
// ---------------------------------------------------------------------------

describe("rasterizer — named colours", () => {
  it("renders 'white' and 'black' correctly", () => {
    const w = {
      kind: PaintCommandKind.FillRect as const,
      rect: { x: 0, y: 0, width: 2, height: 2 },
      color: "white",
      sourceBox: null as never,
    };
    const b = {
      kind: PaintCommandKind.FillRect as const,
      rect: { x: 2, y: 0, width: 2, height: 2 },
      color: "black",
      sourceBox: null as never,
    };
    const { pixels } = rasterize([w, b], 4, 2);
    expect(pixel(pixels, 4, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(pixel(pixels, 4, 3, 0)).toEqual([0, 0, 0, 255]);
  });

  it("'transparent' produces zero alpha", () => {
    const cmd = {
      kind: PaintCommandKind.FillRect as const,
      rect: { x: 0, y: 0, width: 4, height: 4 },
      color: "transparent",
      sourceBox: null as never,
    };
    const { pixels } = rasterize([cmd], 4, 4);
    expect(pixel(pixels, 4, 1, 1)).toEqual([0, 0, 0, 0]);
  });
});

// ---------------------------------------------------------------------------
// Cross-session integration — full pipeline 1→7
// ---------------------------------------------------------------------------

describe("rasterizer — full pipeline integration", () => {
  it("produces a non-zero pixel from a simple div with background colour", () => {
    const div = el("div");
    const dom = el("div", [div]);
    const result = pipelineRaster(
      dom,
      styleMap(new Map([[div, { backgroundColor: "#ff0000", width: 50, height: 50 }]])),
      100,
      100,
    );

    // At least one pixel should be opaque red
    let hasRed = false;
    for (let y = 0; y < result.height; y++) {
      for (let x = 0; x < result.width; x++) {
        const [r, g, b, a] = pixel(result.pixels, result.width, x, y);
        if (r === 255 && g === 0 && b === 0 && a === 255) hasRed = true;
      }
    }
    expect(hasRed).toBe(true);
  });

  it("renders opaque white background for a div with text", () => {
    const dom = el("div", [text("Hello")]);
    const result = pipelineRaster(
      dom,
      styleMap(new Map([[dom, { backgroundColor: "#ffffff", width: 200, height: 100 }]])),
      200,
      100,
    );

    // At least one opaque white pixel
    let hasWhite = false;
    for (let y = 0; y < result.height; y++) {
      for (let x = 0; x < result.width; x++) {
        const [r, g, b, a] = pixel(result.pixels, result.width, x, y);
        if (r === 255 && g === 255 && b === 255 && a === 255) hasWhite = true;
      }
    }
    expect(hasWhite).toBe(true);
  });
});
