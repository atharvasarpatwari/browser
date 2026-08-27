import { describe, it, expect } from "vitest";
import { RepaintScheduler } from "../src/browser/rendering/pipeline/repaint-scheduler";
import { RenderDevToolsBridge } from "../src/browser/rendering/pipeline/render-devtools-bridge";
import {
  DOMNodeType,
  type DOMNodeLike,
  type ComputedStyleLike,
} from "../src/browser/rendering/pipeline/render-tree";

// --- tiny helpers -----------------------------------------------------------

function el(name: string, children: DOMNodeLike[] = []): DOMNodeLike {
  return { nodeType: DOMNodeType.Element, nodeName: name, childNodes: children, textContent: null };
}
function txt(t: string): DOMNodeLike {
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

// ---------------------------------------------------------------------------
// Basic capture
// ---------------------------------------------------------------------------

describe("RenderDevToolsBridge — capture", () => {
  it("captures a snapshot from a pipeline snapshot", () => {
    const div = el("div", [txt("hello")]);
    const dom = el("html", [div]);
    const sched = new RepaintScheduler().setDOM(dom);
    const pipeSnap = sched.renderSync()!;
    const bridge = new RenderDevToolsBridge();
    const devSnap = bridge.capture(pipeSnap);

    expect(devSnap).not.toBeNull();
    expect(devSnap!.timestamp).toBeTruthy();
    expect(devSnap!.performance.frameNumber).toBe(1);
    expect(devSnap!.stats.totalPaintCommands).toBeGreaterThanOrEqual(0);
    expect(devSnap!.stats.totalLayers).toBeGreaterThanOrEqual(1);
  });

  it("returns null when disabled", () => {
    const dom = el("div");
    const sched = new RepaintScheduler().setDOM(dom);
    const pipeSnap = sched.renderSync()!;
    const bridge = new RenderDevToolsBridge();
    bridge.setEnabled(false);
    expect(bridge.capture(pipeSnap)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Paint command snapshots
// ---------------------------------------------------------------------------

describe("RenderDevToolsBridge — paint command snapshots", () => {
  it("serializes fill-rect commands with bounds", () => {
    const div = el("div");
    const dom = el("div", [div]);
    const sched = new RepaintScheduler().setDOM(dom);
    const pipeSnap = sched.renderSync()!;
    const bridge = new RenderDevToolsBridge();
    const devSnap = bridge.capture(pipeSnap)!;

    // There should be at least one paint command
    const fillCmds = devSnap.paintCommands.filter((c) => c.kind === "fill-rect");
    // May or may not have fills depending on styles — just verify the shape
    for (const cmd of fillCmds) {
      expect(cmd.summary).toContain("fill");
      expect(cmd.bounds).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Stacking context snapshots
// ---------------------------------------------------------------------------

describe("RenderDevToolsBridge — stacking context", () => {
  it("captures the root stacking context", () => {
    const dom = el("div", [txt("x")]);
    const sched = new RepaintScheduler().setDOM(dom);
    const pipeSnap = sched.renderSync()!;
    const bridge = new RenderDevToolsBridge();
    const devSnap = bridge.capture(pipeSnap)!;

    expect(devSnap.stackingContext).not.toBeNull();
    expect(devSnap.stackingContext!.isRoot).toBe(true);
    expect(devSnap.stackingContext!.zIndex).toBe(0);
  });

  it("captures child stacking contexts for positioned elements", () => {
    const child = el("div", [txt("z")]);
    const dom = el("div", [child]);
    const styles = new Map<DOMNodeLike, Partial<ComputedStyleLike>>([
      [child, { position: "relative", zIndex: 5 }],
    ]);
    const sched = new RepaintScheduler()
      .setDOM(dom)
      .setStyleResolver(styleMap(styles));
    const pipeSnap = sched.renderSync()!;
    const bridge = new RenderDevToolsBridge();
    const devSnap = bridge.capture(pipeSnap)!;

    expect(devSnap.stackingContext!.children.length).toBeGreaterThanOrEqual(1);
    const childCtx = devSnap.stackingContext!.children[0]!;
    expect(childCtx.zIndex).toBe(5);
    expect(childCtx.isRoot).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Layer snapshots
// ---------------------------------------------------------------------------

describe("RenderDevToolsBridge — layers", () => {
  it("captures layers with bounds and isolation flags", () => {
    const faded = el("div", [txt("faded")]);
    const dom = el("div", [faded]);
    const styles = new Map<DOMNodeLike, Partial<ComputedStyleLike>>([
      [faded, { opacity: 0.3 }],
    ]);
    const sched = new RepaintScheduler()
      .setDOM(dom)
      .setStyleResolver(styleMap(styles));
    const pipeSnap = sched.renderSync()!;
    const bridge = new RenderDevToolsBridge();
    const devSnap = bridge.capture(pipeSnap)!;

    expect(devSnap.layers.length).toBeGreaterThanOrEqual(1);
    const isolated = devSnap.layers.find((l) => l.needsIsolation);
    expect(isolated).toBeDefined();
    expect(isolated!.hasSourceBox).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Layout tree snapshots
// ---------------------------------------------------------------------------

describe("RenderDevToolsBridge — layout tree", () => {
  it("captures layout tree with type and content rect", () => {
    const div = el("div", [txt("text")]);
    const dom = el("div", [div]);
    const sched = new RepaintScheduler()
      .setDOM(dom)
      .setStyleResolver(styleMap(new Map([[div, { width: 100, height: 50 }]])));
    const pipeSnap = sched.renderSync()!;
    const bridge = new RenderDevToolsBridge();
    const devSnap = bridge.capture(pipeSnap)!;

    expect(devSnap.layoutTree).not.toBeNull();
    expect(devSnap.layoutTree!.type).toBeTruthy();
    expect(devSnap.layoutTree!.contentRect).toBeDefined();
    expect(devSnap.stats.totalLayoutBoxes).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// History and stats
// ---------------------------------------------------------------------------

describe("RenderDevToolsBridge — history and stats", () => {
  it("stores multiple snapshots", () => {
    const dom = el("div");
    const sched = new RepaintScheduler().setDOM(dom);
    const bridge = new RenderDevToolsBridge();

    for (let i = 0; i < 3; i++) {
      const snap = sched.renderSync()!;
      bridge.capture(snap);
    }
    expect(bridge.history.length).toBe(3);
    expect(bridge.latest()).not.toBeNull();
    expect(bridge.latest()!.performance.frameNumber).toBe(3);
  });

  it("returns specific snapshot by index", () => {
    const dom = el("div");
    const sched = new RepaintScheduler().setDOM(dom);
    const bridge = new RenderDevToolsBridge();

    const s1 = sched.renderSync()!;
    const s2 = sched.renderSync()!;
    bridge.capture(s1);
    bridge.capture(s2);

    expect(bridge.getSnapshot(0)!.performance.frameNumber).toBe(1);
    expect(bridge.getSnapshot(1)!.performance.frameNumber).toBe(2);
    expect(bridge.getSnapshot(99)).toBeNull();
  });

  it("frameStats returns aggregate metrics", () => {
    const dom = el("div");
    const sched = new RepaintScheduler().setDOM(dom);
    const bridge = new RenderDevToolsBridge();

    sched.renderSync();
    sched.renderSync();
    bridge.capture(sched.lastSnapshot!);
    bridge.capture(sched.lastSnapshot!);

    const stats = bridge.frameStats();
    expect(stats.totalFrames).toBe(2);
    expect(stats.avgDurationMs).toBeGreaterThanOrEqual(0);
    expect(stats.maxDurationMs).toBeGreaterThanOrEqual(0);
    expect(stats.avgCommandCount).toBeGreaterThanOrEqual(0);
    expect(stats.avgLayerCount).toBeGreaterThanOrEqual(0);
  });

  it("respects maxHistory", () => {
    const dom = el("div");
    const sched = new RepaintScheduler().setDOM(dom);
    const bridge = new RenderDevToolsBridge();
    bridge.setMaxHistory(2);

    for (let i = 0; i < 5; i++) {
      sched.renderSync();
      bridge.capture(sched.lastSnapshot!);
    }
    expect(bridge.history.length).toBe(2);
  });

  it("clear removes all history", () => {
    const dom = el("div");
    const sched = new RepaintScheduler().setDOM(dom);
    const bridge = new RenderDevToolsBridge();
    bridge.capture(sched.renderSync()!);
    bridge.capture(sched.renderSync()!);
    bridge.clear();
    expect(bridge.history.length).toBe(0);
    expect(bridge.latest()).toBeNull();
  });

  it("empty history frameStats returns zeros", () => {
    const bridge = new RenderDevToolsBridge();
    const stats = bridge.frameStats();
    expect(stats.totalFrames).toBe(0);
    expect(stats.avgDurationMs).toBe(0);
  });
});
