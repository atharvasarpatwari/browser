/**
 * @file src/browser/engine/page-renderer.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Standalone implementation of IPageRenderer that handles the full rendering
 * pipeline from parsed HTML to painted output. Handles:
 *   • HTML parsing → DOM tree construction
 *   • CSS extraction → computed style application
 *   • Script execution (blocking/defer/async)
 *   • Layout computation
 *   • Lazy loading setup
 *   • Paint rendering
 *   • Abort signal propagation through the pipeline
 *
 * Does NOT:
 *   • Fetch pages from URLs (PageLoader's job)
 *   • Manage caching (ResourceLoader's job)
 *   • Handle networking (ResourcePrioritizer's job)
 *
 * OOP PRINCIPLES
 * ─────────────────────
 *  Single-Resp.     Only renders content into the visible view.
 *  Encapsulation    All helper methods are private; callers use render().
 *  Dependency-Inv.  Depends on interfaces, not concrete implementations.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { IDisposable } from '../../app/dependency-container';
import type { IResourceLoader } from '../networking/resource-loader';
import type { IDomTree, DomNode, DomElement, DomDocument, UsedStyle } from '../rendering/dom-tree';
import type { ICssParser, CssRule } from '../rendering/css-parser';
import type { ILayoutEngine } from '../rendering/layout-engine';
import type { IPaintEngine } from '../rendering/paint-engine';
import type { INavigationController } from '../navigation/navigation-controller';
import type { StyleableElement } from '../rendering/css5/cascade';
import type {
  CssStylesheet as Css5Stylesheet,
  CssRule as Css5Rule,
  CssStyleRule,
} from '../rendering/css5/types';
import type { IPageRenderer, PageLoadResult } from './browser-engine';
import { HtmlParser } from '../rendering/html-parser';
import { CssParser } from '../rendering/css-parser';
import { LazyLoader } from '../rendering/lazy-loader';
import { DomTree } from '../rendering/dom-tree';
import { LayoutEngine } from '../rendering/layout-engine';
import { PaintEngine } from '../rendering/paint-engine';
import { ResourcePrioritizer } from '../networking/resource-prioritizer';
import { computeComputedStyles, collectKeyframes } from '../rendering/css5/cascade';
import { buildUsedStyle } from '../rendering/css5/used-style';
import { runJS } from '../js/index';
import { EventLoop as JsEventLoop } from '../js/event-loop';
import { HtmlSanitizer } from '../security/html-sanitizer';
import type { CspScriptEnforcer } from '../security/csp-script-enforcer';
import type { SecurityLayer } from '../media/security-layer';
import { ReflowRepaintController } from '../rendering/reflow-repaint-controller';
import type { LayerCompositor } from '../rendering/compositing/layer-compositor';
import { CssAnimationAnimator } from '../rendering/css-animations';
import { setAnimationRuntime } from '../js/dom-bindings';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTRUCTOR PARAMETERS
// ─────────────────────────────────────────────────────────────────────────────

interface PageRendererDependencies {
  readonly htmlParser: HtmlParser;
  readonly domTree: IDomTree;
  readonly cssParser: ICssParser;
  readonly layoutEngine: ILayoutEngine;
  readonly paintEngine: IPaintEngine;
  readonly resourceLoader: IResourceLoader;
  readonly prioritizer: ResourcePrioritizer;
  /** Optional NavigationController — provides window.history / window.location to scripts. */
  readonly controller?: INavigationController;
  /** Optional HTML sanitizer — strips dangerous elements/attributes after tree building. */
  readonly sanitizer?: HtmlSanitizer;
  /** Optional CSP script enforcer — checks script-src before execution. */
  readonly scriptEnforcer?: CspScriptEnforcer;
  /** Optional CSP resource enforcer — passed to JS engine for fetch() connect-src checks. */
  readonly resourceEnforcer?: import('../security/csp-resource-enforcer').CspResourceEnforcer;
  /** Optional security layer — enforces mixed-content/CSRF/SRI on sub-resources. */
  readonly securityLayer?: SecurityLayer;
  /** Optional base directory for persistent page web storage (localStorage/IndexedDB). */
  readonly storageDir?: string;
  /** Optional callback invoked after each reflow/repaint frame (page repaint). */
  readonly onFrameRendered?: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONCRETE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

class PageRenderer implements IPageRenderer, IDisposable {
  private readonly deps: PageRendererDependencies;
  private disposed = false;
  private reflowController: ReflowRepaintController | null = null;

  constructor(deps: PageRendererDependencies) {
    this.deps = deps;
  }

  /**
   * Parses and renders a fetched document into the visible view.
   *
   * @param result The loaded page content from PageLoader.
   * @param signal AbortSignal for cancellation.
   */
  async render(result: PageLoadResult, signal: AbortSignal): Promise<void> {
    if (this.disposed) {
      throw new Error('PageRenderer has been disposed');
    }

    const { htmlParser, domTree, cssParser, layoutEngine, paintEngine, resourceLoader, prioritizer } = this.deps;

    // 0. Apply response-time security policies (COOP/COEP/CORP, referrer-policy).
    //    Top-level documents are not framed, so clickjacking is skipped here.
    this.deps.securityLayer?.applyResponseHeaders(result.url, result.headers, { framed: false });

    // 1. Parse HTML
    const parseResult = htmlParser.parse(result.body, result.url);
    const htmlDoc = parseResult.document;

    // 2. Submit discovered resources to the prioritizer for batch loading
    if (parseResult.resources.length > 0) {
      prioritizer.submitBatch(parseResult.resources);
    }

    // 3. Convert the parsed HTML into our internal DOM tree representation
    const doc = domTree.buildFromHtml(htmlDoc);

    // 3b. Sanitize DOM tree — strip dangerous elements and attributes
    if (this.deps.sanitizer) {
      this.deps.sanitizer.sanitize(doc, domTree);
    }

    // 4. Extract and compute CSS styles
    const rules = cssParser.extractStylesFromDocument(htmlDoc);
    this._lastRules = rules;
    this.applyComputedStyles(rules);

    // 5. Execute scripts: inline synchronously, external fetched via ResourceLoader
    await this.executeAllScripts(doc, result.url, signal);
    this.applyComputedStyles(rules); // Re-apply after script execution

    // 6. Run layout
    layoutEngine.layout(doc, domTree);

    // 7. Lazy load images/iframes via IntersectionObserver
    const lazyLoader = new LazyLoader();
    lazyLoader.init(doc, domTree, resourceLoader, result.url);
    // Async image/iframe loads must invalidate the painted subtree and
    // schedule a reflow frame so the decoded resource appears on screen.
    lazyLoader.onAnyLoad((event) => {
      const el = event.target as DomElement;
      this.reflowController?.invalidatePaint(el);
      this.reflowController?.requestFrame();
    });
    lazyLoader.scanForLazyElements(doc);
    lazyLoader.setViewport(1920, 1080); // Default viewport

    // 8. Paint
    paintEngine.paint(doc);

    // 9. Clear mutations recorded during the initial full style pass. They are
    //    stale (already reflected in the laid-out, painted tree) and would
    //    otherwise make the first incremental frame re-layout the whole tree,
    //    wiping paint-dirty flags set by async loads (e.g. decoded images)
    //    before paintIncremental could re-rasterize them.
    domTree.clearMutations();

    // 10. Render iframe child documents. Each iframe's src is fetched and
    //     rasterized through a fresh sub-pipeline into el.imageData so the
    //     parent paint pass composites the embedded page.
    const iframeCount = await this.renderIframeChildren(doc, result.url);
    if (iframeCount > 0) {
      // Full repaint so embedded frames appear in the very first rasterized
      // output rather than waiting for an incremental reflow frame.
      paintEngine.paint(doc);
      domTree.clearMutations();
    }

    // 11. Wire the incremental reflow/repaint controller for post-load DOM
    //     mutations (JS-triggered changes, scroll/scroll-triggered relayout).
    this.initReflowController(doc);
  }

  /**
   * Creates (or resets) the ReflowRepaintController for the current document.
   * After the initial full layout+paint, all subsequent DOM mutations flow
   * through this controller so only dirty subtrees are re-laid-out/repainted.
   */
  private initReflowController(doc: DomDocument): void {
    const { domTree, layoutEngine, paintEngine } = this.deps;

    this.reflowController?.dispose();
    const controller = new ReflowRepaintController(layoutEngine, paintEngine, domTree, {
      viewportWidth: 1920,
      viewportHeight: 1080,
    });
    controller.init(doc);
    // Incremental style recalc resolves _dirtyStyle nodes before layout.
    controller.setStyleRecalcCallback(() => this.recalcStylesIncremental());
    // Notify the UI (via the engine) when a reflow frame repaints the page.
    controller.setFrameCallback(() => this.deps.onFrameRendered?.());
    // Layer-based compositing when a compositor is available.
    const compositor = (paintEngine as { getLayerCompositor?: () => LayerCompositor | null }).getLayerCompositor?.();
    if (compositor) controller.setLayerCompositor(compositor);

    // Animation bridge: CSS @keyframes and element.animate() drive animated
    // opacity through the paint pipeline (overlay read at paint time).
    const animator = new CssAnimationAnimator({
      domTree,
      timeline: controller.animationTimeline,
      getKeyframes: () => (this._lastStylesheet ? collectKeyframes(this._lastStylesheet) : new Map()),
    });
    controller.setAnimationAnimator(animator);
    paintEngine.setOpacityResolver((el) => animator.resolveOpacity(el));
    setAnimationRuntime({ timeline: controller.animationTimeline, animator });

    this.reflowController = controller;
    // Start the incremental loop; while animations are active it self-schedules.
    controller.requestFrame();
  }

  // ── Private Helper Methods ──────────────────────────────────────────────

  /**
   * Walks the DOM tree, builds a StyleableElement mirror for CSS5 selector
   * matching, and applies computed styles to every element so the layout /
   * paint engines can consume them via node.computedStyle.
   *
   * Also builds a UsedStyle object for each element with pixel-resolved
   * box-model values for faster layout.
   */
  private applyComputedStyles(rules: readonly CssRule[]): void {
    const { domTree, cssParser } = this.deps;
    const doc = domTree.getDocument();
    if (!doc) return;

    // Build a CSS5 stylesheet from legacy CssRule[] (reparse selectors once).
    const stylesheet = this.buildCss5Stylesheet(cssParser, rules);
    this._lastStylesheet = stylesheet;

    // Determine container dimensions for percentage-based used-style resolution.
    const bodyEl = doc.bodyElement;
    const containerWidth = bodyEl?.layoutBox?.width ?? 1920;
    const containerHeight = bodyEl?.layoutBox?.height ?? 1080;

    // Pass 1: Build StyleableElement tree mirroring the DOM tree.
    const rootStyleables = this.buildStyleableTree(doc.children, null);

    // Pass 2: Compute and apply styles top-down.
    this.applyStylesRecursive(doc.children, rootStyleables, stylesheet, null, containerWidth, containerHeight, domTree);
  }

  /**
   * Incremental style recalc: walks only elements with _dirtyStyle flag,
   * recomputes their computed styles and used styles, and clears the flag.
   */
  private recalcStylesIncremental(): void {
    const { domTree, cssParser } = this.deps;
    const doc = domTree.getDocument();
    if (!doc) return;

    const bodyEl = doc.bodyElement;
    const containerWidth = bodyEl?.layoutBox?.width ?? 1920;
    const containerHeight = bodyEl?.layoutBox?.height ?? 1080;

    const dirtyNodes = this.collectDirtyNodes(doc);
    if (dirtyNodes.length === 0) return;

    // Build a fresh stylesheet (rules may have changed).
    const legacyParser = cssParser;
    const stylesheet = this.buildCss5Stylesheet(legacyParser, this._lastRules);
    this._lastStylesheet = stylesheet;

    for (const el of dirtyNodes) {
      const parentComputed = el.parent?.nodeType === 'element'
        ? (el.parent as DomElement).computedStyle as Map<string, string> | undefined
        : undefined;

      const styleable = this.buildSingleStyleable(el);
      const computed = computeComputedStyles(
        styleable,
        stylesheet,
        undefined,
        parentComputed,
      );
      domTree.setComputedStyle(el, computed);

      const usedStyle = buildUsedStyle(computed, containerWidth, containerHeight, 16);
      domTree.setUsedStyle(el, usedStyle);

      domTree.clearDirty(el, 'style');
    }
  }

  private _lastRules: readonly CssRule[] = [];
  private _lastStylesheet: Css5Stylesheet | null = null;

  /**
   * Collect all elements with _dirtyStyle === true in the DOM tree.
   */
  private collectDirtyNodes(doc: DomDocument): DomElement[] {
    const result: DomElement[] = [];
    const walk = (nodes: readonly DomNode[]): void => {
      for (const n of nodes) {
        if (n.nodeType === 'element') {
          const el = n as DomElement;
          if (el._dirtyStyle) result.push(el);
          walk(el.children);
        }
      }
    };
    walk(doc.children);
    return result;
  }

  /**
   * Build a single StyleableElement wrapper for an element (for incremental recalc).
   *
   * Walks up to the topmost element so the built subtree contains the full
   * ancestor chain (needed for CSS inheritance), then descends to return the
   * styleable matching `el`. This avoids the mutual parent↔child recursion that
   * previously overflowed the call stack.
   */
  private buildSingleStyleable(el: DomElement): StyleableElement {
    let top = el;
    while (top.parent?.nodeType === 'element') top = top.parent as DomElement;

    const nodes = new WeakMap<DomElement, StyleableElement>();
    const build = (node: DomElement, parent: StyleableElement | null): StyleableElement => {
      const styleable: StyleableElement = {
        tagName: node.tagName,
        attributes: node.attributes,
        parent,
        children: [],
      };
      nodes.set(node, styleable);
      styleable.children = node.children
        .filter((c): c is DomElement => c.nodeType === 'element')
        .map(c => build(c, styleable));
      return styleable;
    };

    build(top, null);
    return nodes.get(el)!;
  }

  /**
   * Executes all scripts found in the DOM tree — both inline and external.
   *
   * Per the WHATWG spec:
   *   1. Blocking scripts (no defer/async): execute synchronously in document
   *      order, pausing HTML parsing. External scripts are fetched first.
   *   2. defer scripts: execute after DOM parsing completes, in document order.
   *   3. async scripts: execute as soon as they finish downloading, regardless
   *      of DOM state.
   *
   * This implementation:
   *   - Executes inline scripts synchronously (already in DOM)
   *   - Fetches external scripts via ResourceLoader and executes them
   *   - Collects defer scripts and runs them after all blocking scripts
   *   - Fires async scripts immediately after fetch (best-effort)
   */
  private async executeAllScripts(
    doc: DomDocument,
    baseUrl: string,
    signal: AbortSignal,
  ): Promise<void> {
    const { domTree, resourceLoader } = this.deps;
    const scripts = domTree.getElementsByTagName('script');
    if (scripts.length === 0) return;

    const eventLoop = new JsEventLoop();

    const blockingScripts: Array<{ source: string; el: typeof scripts[0] }> = [];
    const deferScripts: Array<{ source: string; el: typeof scripts[0] }> = [];
    const asyncScripts: Array<{ source: string; el: typeof scripts[0] }> = [];

    // Categorize scripts
    for (const script of scripts) {
      // Check if signal is already aborted
      if (signal.aborted) break;

      const hasSrc = script.attributes.has('src');
      const isDefer = script.attributes.has('defer');
      const isAsync = script.attributes.has('async');

      if (hasSrc) {
        const src = script.attributes.get('src') ?? '';
        const fullUrl = PageRenderer.resolveUrl(src, baseUrl);
        const security = this.deps.securityLayer;

        if (security) {
          const check = security.checkSubresource(baseUrl, fullUrl, 'script');
          if (!check.allowed) {
            console.warn(
              `[Security] Blocked external script: ${fullUrl} (${check.reason ?? 'denied'})`,
            );
            continue;
          }
        }

        try {
          const source = await resourceLoader.loadScript(fullUrl);

          if (security) {
            const integrity = script.attributes.get('integrity');
            if (integrity && integrity.trim() !== '') {
              const verified = security.verifySubresourceIntegrity(integrity, source);
              if (verified.state === 'invalid' && security.subresourceIntegrity.isEnforce()) {
                console.warn(
                  `[Security] SRI integrity mismatch blocked script: ${fullUrl}`,
                );
                continue;
              }
            }
          }

          if (isAsync) {
            asyncScripts.push({ source, el: script });
          } else if (isDefer) {
            deferScripts.push({ source, el: script });
          } else {
            blockingScripts.push({ source, el: script });
          }
        } catch (err) {
          console.error(
            `[ScriptEngine] Failed to fetch external script: ${fullUrl}`,
            err instanceof Error ? err.message : err,
          );
        }
      } else {
        // Inline script — extract text content
        let source = '';
        for (const child of script.children) {
          if (child.nodeType === 'text') {
            source += (child as unknown as { text: string }).text;
          }
        }
        source = source.trim();
        if (source === '') continue;

        // Inline scripts without defer/async are blocking by default
        blockingScripts.push({ source, el: script });
      }
    }

    // 1. Execute blocking scripts in document order
    for (const { source } of blockingScripts) {
      if (signal.aborted) break;
      if (this.deps.scriptEnforcer) {
        const check = this.deps.scriptEnforcer.checkInlineScript(source, baseUrl, baseUrl);
        if (!check.allowed) {
          console.warn(`[CSP] Blocked inline script: ${check.reason}`);
          continue;
        }
      }
      const result2 = runJS(source, { document: doc, domTree, eventLoop, controller: this.deps.controller, resourceEnforcer: this.deps.resourceEnforcer, scriptEnforcer: this.deps.scriptEnforcer, pageOrigin: baseUrl, htmlParser: this.deps.htmlParser, storageDir: this.deps.storageDir });
      if (result2.error) {
        console.error(
          `[ScriptEngine] Error executing blocking script: ${result2.error.message}`,
        );
      }
    }

    // 2. Execute defer scripts in document order (after DOM is parsed)
    for (const { source } of deferScripts) {
      if (signal.aborted) break;
      if (this.deps.scriptEnforcer) {
        const check = this.deps.scriptEnforcer.checkInlineScript(source, baseUrl, baseUrl);
        if (!check.allowed) {
          console.warn(`[CSP] Blocked defer script: ${check.reason}`);
          continue;
        }
      }
      const result2 = runJS(source, { document: doc, domTree, eventLoop, controller: this.deps.controller, resourceEnforcer: this.deps.resourceEnforcer, scriptEnforcer: this.deps.scriptEnforcer, pageOrigin: baseUrl, htmlParser: this.deps.htmlParser, storageDir: this.deps.storageDir });
      if (result2.error) {
        console.error(
          `[ScriptEngine] Error executing defer script: ${result2.error.message}`,
        );
      }
    }

    // 3. Fire async scripts (best-effort — they may already be downloaded)
    for (const { source, el } of asyncScripts) {
      if (this.deps.scriptEnforcer) {
        const check = this.deps.scriptEnforcer.checkInlineScript(source, baseUrl, baseUrl);
        if (!check.allowed) {
          console.warn(`[CSP] Blocked async script: ${check.reason}`);
          void el;
          continue;
        }
      }
      // Fire and forget — async scripts don't block rendering
      runJS(source, { document: doc, domTree, eventLoop, controller: this.deps.controller, resourceEnforcer: this.deps.resourceEnforcer, scriptEnforcer: this.deps.scriptEnforcer, pageOrigin: baseUrl, htmlParser: this.deps.htmlParser, storageDir: this.deps.storageDir });
      void el; // used only for categorization
    }
  }

  /**
   * Simple URL resolution — resolves a relative URL against a base.
   */
  private static resolveUrl(relative: string, base: string): string {
    if (relative.startsWith('http://') || relative.startsWith('https://') || relative.startsWith('//')) {
      return relative;
    }
    try {
      return new URL(relative, base).href;
    } catch {
      return relative;
    }
  }

  /**
   * Converts legacy CssRule[] (string selectors) into a CssStylesheet
   * that the CSS5 cascade engine can consume.
   */
  private buildCss5Stylesheet(cssParser: ICssParser, rules: readonly CssRule[]): Css5Stylesheet {
    const css5Rules: Css5Rule[] = [];
    const parser = (cssParser as CssParser).getCss5Parser();

    let order = 0;
    for (const rule of rules) {
      if (rule.selector === '__external__') continue;

      // @keyframes rules (selector === '') are carried through the legacy
      // CssRule[] pipe so the animator can resolve them at runtime.
      if (rule.keyframes) {
        css5Rules.push({
          type: 'keyframes',
          name: rule.keyframes.name,
          keyframes: rule.keyframes.frames.map((kf) => ({
            selectors: kf.selectors,
            declarations: Array.from(kf.declarations.entries()).map(([property, value]) => ({
              property,
              value,
              important: false,
            })),
          })),
        });
        continue;
      }

      const selector = parser.parseSelector(rule.selector);
      if (!selector) continue;

      const styleRule: CssStyleRule = {
        type: 'style',
        selectors: [selector],
        declarations: Array.from(rule.declarations.entries()).map(([prop, value]) => ({
          property: prop,
          value,
          important: false,
        })),
        specificity: { id: rule.specificity.id, a: rule.specificity.class, b: rule.specificity.tag },
        sourceOrder: order++,
        sourceUrl: rule.sourceUrl,
      };
      css5Rules.push(styleRule);
    }

    return { rules: css5Rules, url: null };
  }

  /**
   * Builds a StyleableElement tree mirroring the DOM tree.
   * Construction is bottom-up: children are built first, then the parent
   * is created with correct child/parent pointers.
   */
  private buildStyleableTree(
    domNodes: readonly DomNode[],
    parentStyleable: StyleableElement | null,
  ): StyleableElement[] {
    const result: StyleableElement[] = [];

    for (const node of domNodes) {
      if (node.nodeType !== 'element') continue;
      const el = node as DomElement;

      // Build children first (bottom-up construction).
      const childStyleables = this.buildStyleableTree(el.children, null);

      const styleable: StyleableElement = {
        tagName: el.tagName,
        attributes: el.attributes,
        parent: parentStyleable,
        children: childStyleables,
      };

      // Fix children's parent pointers to point to this node.
      for (const child of childStyleables) {
        child.parent = styleable;
      }

      result.push(styleable);
    }

    return result;
  }

  /**
   * Recursively computes and applies CSS styles to every element in the DOM tree.
   * Walks top-down so parent computed styles can be passed for inheritance.
   */
  private applyStylesRecursive(
    domNodes: readonly DomNode[],
    styleables: readonly StyleableElement[],
    stylesheet: Css5Stylesheet,
    parentComputed: Map<string, string> | null,
    containerWidth: number,
    containerHeight: number,
    domTree: IDomTree,
  ): void {
    let i = 0;
    for (const node of domNodes) {
      if (node.nodeType !== 'element') continue;
      const el = node as DomElement;
      const styleable = styleables[i++];

      const computed = computeComputedStyles(
        styleable,
        stylesheet,
        undefined,
        parentComputed ?? undefined,
      );
      domTree.setComputedStyle(el, computed);

      // Build used style for faster layout
      const used = buildUsedStyle(computed, containerWidth, containerHeight, 16);
      domTree.setUsedStyle(el, used);

      // Recurse into children with this element's computed styles as parent.
      this.applyStylesRecursive(
        el.children,
        styleable.children,
        stylesheet,
        computed,
        containerWidth,
        containerHeight,
        domTree,
      );
    }
  }

  /**
   * Fetches and rasterizes each `<iframe src=…>` child document in the given
   * DOM tree into the iframe element's `imageData` so the parent paint pass
   * composites the embedded page. Returns the number of iframes rendered.
   */
  private async renderIframeChildren(doc: DomDocument, baseUrl: string): Promise<number> {
    const iframes: DomElement[] = [];
    const walk = (nodes: readonly DomNode[]): void => {
      for (const node of nodes) {
        if (node.nodeType !== 'element') continue;
        const el = node as DomElement;
        if (el.tagName.toLowerCase() === 'iframe') iframes.push(el);
        walk(el.children);
      }
    };
    walk(doc.children);
    if (iframes.length === 0) return 0;

    let rendered = 0;
    for (const iframe of iframes) {
      const src = iframe.attributes.get('src');
      if (!src) continue;
      try {
        const absolute = new URL(src, baseUrl).toString();
        const res = await this.deps.resourceLoader.loadResource(absolute, 'document');
        if (res.error || !res.body) continue;

        // Size the embedded frame from the iframe's laid-out box.
        const layoutBox = this.deps.layoutEngine.getLayoutBox(iframe.domId);
        const width = Math.max(1, Math.round(layoutBox?.width ?? 400));
        const height = Math.max(1, Math.round(layoutBox?.height ?? 200));

        const imageData = this.renderNestedDocument(res.body, absolute, width, height);
        if (imageData) {
          iframe.imageData = imageData;
          iframe.loadingState = 'loaded';
          rendered++;
        }
      } catch {
        // Ignore iframe fetch/render failures; the frame stays blank.
      }
    }
    return rendered;
  }

  /**
   * Renders a standalone HTML document (iframe child page) through a fresh
   * parse → style → layout → paint → rasterize sub-pipeline. Returns the
   * rasterized ImageData sized to the given width/height, or null on failure.
   */
  private renderNestedDocument(
    body: string,
    url: string,
    width: number,
    height: number,
  ): ImageData | null {
    try {
      const htmlParser = new HtmlParser();
      const cssParser = new CssParser();
      const domTree = new DomTree();
      const layoutEngine = new LayoutEngine();
      const paintEngine = new PaintEngine();

      const parseResult = htmlParser.parse(body, url);
      const doc = domTree.buildFromHtml(parseResult.document);

      const rules = cssParser.extractStylesFromDocument(parseResult.document);
      const stylesheet = this.buildCss5Stylesheet(cssParser, rules);
      const rootStyleables = this.buildStyleableTree(doc.children, null);
      this.applyStylesRecursive(
        doc.children,
        rootStyleables,
        stylesheet,
        null,
        width,
        height,
        domTree,
      );

      layoutEngine.layout(doc, domTree, { viewportWidth: width, viewportHeight: height });
      paintEngine.updateConfig({ width, height, backgroundColor: '#ffffff' });
      paintEngine.paint(doc);
      return paintEngine.rasterize();
    } catch {
      return null;
    }
  }

  // ── Public Accessors ─────────────────────────────────────────────────────

  /**
   * Gets the DOM tree instance.
   */
  getDomTree(): IDomTree {
    return this.deps.domTree;
  }

  /**
   * Gets the layout engine instance.
   */
  getLayoutEngine(): ILayoutEngine {
    return this.deps.layoutEngine;
  }

  /**
   * Gets the paint engine instance.
   */
  getPaintEngine(): IPaintEngine {
    return this.deps.paintEngine;
  }

  /**
   * Gets the resource loader instance.
   */
  getResourceLoader(): IResourceLoader {
    return this.deps.resourceLoader;
  }

  /**
   * Gets the resource prioritizer instance.
   */
  getPrioritizer(): ResourcePrioritizer {
    return this.deps.prioritizer;
  }

  /**
   * Gets the incremental reflow/repaint controller for the current document,
   * or null if render() has not completed yet.
   */
  getReflowController(): ReflowRepaintController | null {
    return this.reflowController;
  }

  /**
   * Request an incremental reflow+repaint of the current document.
   * Coalesced by the controller's FrameScheduler — safe to call repeatedly.
   */
  requestReflow(): void {
    const doc = this.deps.domTree.getDocument();
    if (!this.reflowController || !doc) return;
    this.reflowController.invalidateLayout(doc);
    this.reflowController.requestFrame();
  }

  // ── Dispose ──────────────────────────────────────────────────────────────

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    setAnimationRuntime(null);
    this.reflowController?.dispose();
    this.reflowController = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export { PageLoader } from './page-loader';
export { PageRenderer };
export type { PageRendererDependencies };
