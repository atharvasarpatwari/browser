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
import { CssTransitionEngine } from '../rendering/css-transitions';
import { HtmlParser } from '../rendering/html-parser';
import { CssParser } from '../rendering/css-parser';
import { LazyLoader } from '../rendering/lazy-loader';
import { DomTree } from '../rendering/dom-tree';
import { LayoutEngine } from '../rendering/layout-engine';
import { PaintEngine } from '../rendering/paint-engine';
import { ResourcePrioritizer } from '../networking/resource-prioritizer';
import { computeComputedStyles, collectKeyframes, evaluatePrefersReducedMotion } from '../rendering/css5/cascade';
import { buildUsedStyle } from '../rendering/css5/used-style';
import { runJS, createGlobalEnv, wrapElement, createEventObject, createMouseEventObject, createKeyboardEventObject, createWheelEventObject, onConsoleMessage, type ConsoleEntry } from '../js/index';
import { callJSFunction, setGlobalCaller, type JSFunction, type JSObject, type Environment } from '../js/values';
import { EventLoop as JsEventLoop } from '../js/event-loop';
import { HtmlSanitizer } from '../security/html-sanitizer';
import type { CspScriptEnforcer } from '../security/csp-script-enforcer';
import type { CspPolicyStore } from '../security/csp-policy-store';
import type { ICorsEngine } from '../security/cors';
import { parseOrigin, OPAQUE_ORIGIN } from '../security/origin-service';
import type { SecurityLayer } from '../media/security-layer';
import { ReflowRepaintController } from '../rendering/reflow-repaint-controller';
import type { LayerCompositor } from '../rendering/compositing/layer-compositor';
import { CssAnimationAnimator } from '../rendering/css-animations';
import { setAnimationRuntime, dispatchAnimationEventToElement } from '../js/dom-bindings';
import type { PermissionName } from '../web-apis/web-apis-permissions';

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
  /** Optional CSP policy store — receives Content-Security-Policy headers from fetched documents. */
  readonly policyStore?: CspPolicyStore;
  /** Optional CORS engine — attached to fetch()/XHR in the JS engine. */
  readonly corsEngine?: ICorsEngine;
  /** Optional security layer — enforces mixed-content/CSRF/SRI on sub-resources. */
  readonly securityLayer?: SecurityLayer;
  /** Optional base directory for persistent page web storage (localStorage/IndexedDB). */
  readonly storageDir?: string;
  /** Optional callback invoked after each reflow/repaint frame (page repaint). */
  readonly onFrameRendered?: () => void;
  /** Optional callback invoked for every page console.log/warn/error/etc call (DevTools Console panel). */
  readonly onConsoleMessage?: (entry: ConsoleEntry) => void;
  /** Optional callback that shows a real permission prompt to the user and resolves with their choice. */
  readonly onPermissionRequest?: (origin: string, name: PermissionName) => Promise<'granted' | 'denied'>;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONCRETE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

class PageRenderer implements IPageRenderer, IDisposable {
  private readonly deps: PageRendererDependencies;
  private disposed = false;
  private reflowController: ReflowRepaintController | null = null;
  private transitionEngine: CssTransitionEngine | null = null;
  /** The shared script EventLoop for the currently rendered page, if it has any scripts. */
  private pageEventLoop: JsEventLoop | null = null;
  /** The shared global JS environment for the currently rendered page — holds `window`, used to dispatch resize events. */
  private pageGlobalEnv: Environment | null = null;
  /** Real-time pump so setTimeout/setInterval/rAF keep firing after the initial script run. */
  private eventLoopPumpTimer: ReturnType<typeof setInterval> | null = null;
  /** URL of the currently rendered page — needed to resolve relative link hrefs/form actions from dispatchPointerEvent, called long after render() returns. */
  private currentPageUrl: string | null = null;

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
    this.currentPageUrl = result.url;

    // 0. Apply response-time security policies (COOP/COEP/CORP, referrer-policy).
    //    Top-level documents are not framed, so clickjacking is skipped here.
    this.deps.securityLayer?.applyResponseHeaders(result.url, result.headers, { framed: false });

    // 0b. CSP policy ingestion — store any Content-Security-Policy /
    //     Content-Security-Policy-Report-Only headers for this document's
    //     origin so the script/resource/navigation enforcers actually run.
    if (this.deps.policyStore) {
      const origin = parseOrigin(result.url);
      const csp = result.headers.get('content-security-policy');
      const cspReportOnly = result.headers.get('content-security-policy-report-only');
      if (origin && origin !== OPAQUE_ORIGIN && (csp || cspReportOnly)) {
        this.deps.policyStore.storeFromHeaders(
          origin,
          csp ? [csp] : [],
          cspReportOnly ? [cspReportOnly] : [],
          result.url,
        );
      }
    }

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
    const rules = cssParser.extractCss5RulesFromDocument(htmlDoc);
    this._lastRules = rules;
    this.applyComputedStyles(rules);

    // 5. Execute scripts: inline synchronously, external fetched via ResourceLoader
    await this.executeAllScripts(doc, result.url, signal);
    this.applyComputedStyles(rules); // Re-apply after script execution

    // 6. Run layout
    // The canvas that ends up on screen is CSS-stretched/shrunk to fill
    // whatever size the content area actually is, but its pixel buffer
    // (and everything drawn into it) was sized to whatever viewport the
    // engine was constructed with — a fixed 1920x1080 default, regardless
    // of the real content area. Any mismatch forces the browser to rescale
    // a sharp, non-anti-aliased bitmap font, which blends adjacent glyphs
    // into each other and made text look like it was overlapping. Render
    // at the content area's real size instead so no rescaling ever has to
    // happen. window.innerHeight is the whole app window including the
    // address bar/tab strip chrome above the content area, so it overshoots;
    // .content-area is the actual element the canvas fills.
    const contentAreaEl = typeof document !== 'undefined' ? document.querySelector('.content-area') : null;
    const viewportWidth = contentAreaEl?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1920);
    const viewportHeight = contentAreaEl?.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 1080);
    layoutEngine.layout(doc, domTree, { viewportWidth, viewportHeight });

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
    lazyLoader.setViewport(viewportWidth, viewportHeight);

    // 8. Paint
    paintEngine.updateConfig({ width: viewportWidth, height: viewportHeight });
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
    this.initReflowController(doc, viewportWidth, viewportHeight);
  }

  /**
   * Creates (or resets) the ReflowRepaintController for the current document.
   * After the initial full layout+paint, all subsequent DOM mutations flow
   * through this controller so only dirty subtrees are re-laid-out/repainted.
   */
  private initReflowController(doc: DomDocument, viewportWidth: number, viewportHeight: number): void {
    const { domTree, layoutEngine, paintEngine } = this.deps;

    this.reflowController?.dispose();
    const controller = new ReflowRepaintController(layoutEngine, paintEngine, domTree, {
      viewportWidth,
      viewportHeight,
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
    paintEngine.setTransformResolver((el) => animator.resolveTransform(el));
    setAnimationRuntime({ timeline: controller.animationTimeline, animator });
    animator.onAnimationEvent = (event) => {
      dispatchAnimationEventToElement(event);
    };

    this.transitionEngine = new CssTransitionEngine({
      domTree,
      timeline: controller.animationTimeline,
      registerAnimation: (anim) => animator.registerAnimation(anim),
      unregisterAnimation: (anim) => animator.unregisterAnimation(anim),
    });
    controller.setTransitionSyncCallback(() => {
      animator.prefersReducedMotion = evaluatePrefersReducedMotion();
      this.transitionEngine?.sync(doc);
    });

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
  private applyComputedStyles(rules: readonly Css5Rule[]): void {
    const { domTree } = this.deps;
    const doc = domTree.getDocument();
    if (!doc) return;

    const stylesheet = this.buildCss5Stylesheet(rules);
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
    const { domTree } = this.deps;
    const doc = domTree.getDocument();
    if (!doc) return;

    const bodyEl = doc.bodyElement;
    const containerWidth = bodyEl?.layoutBox?.width ?? 1920;
    const containerHeight = bodyEl?.layoutBox?.height ?? 1080;

    const dirtyNodes = this.collectDirtyNodes(doc);
    if (dirtyNodes.length === 0) return;

    // Build a fresh stylesheet (rules may have changed).
    const stylesheet = this.buildCss5Stylesheet(this._lastRules);
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

  private _lastRules: readonly Css5Rule[] = [];
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
    // A new page is replacing whatever was here — stop pumping the old one's
    // timers so a stale page's setInterval doesn't keep firing in the background.
    this.stopEventLoopPump();

    const { domTree, resourceLoader } = this.deps;
    const scripts = domTree.getElementsByTagName('script');
    if (scripts.length === 0) return;

    // Canonical page origin for CSP lookups and CORS checks (scheme://host[:port]).
    const origin = parseOrigin(baseUrl);

    const eventLoop = new JsEventLoop();
    // One shared global environment for every <script> tag on this page —
    // real pages routinely split JS across multiple tags expecting a single
    // shared `window` (a library script, then a script that uses it). Each
    // runJS() call below defaults to creating its OWN fresh environment when
    // none is passed, which would silently isolate every script tag from
    // every other one; passing this explicitly is what prevents that.
    const globalEnv = createGlobalEnv(
      doc, domTree, eventLoop, this.deps.controller, undefined,
      this.deps.resourceEnforcer, this.deps.scriptEnforcer, baseUrl,
      this.deps.htmlParser, this.deps.storageDir,
      this.deps.corsEngine,
      resourceLoader.getCookieJar() ?? undefined,
      this.deps.onPermissionRequest,
    );

    // Forward every console.log/warn/error/etc the page makes to whoever's
    // listening (e.g. a DevTools Console panel) — createGlobalEnv binds a
    // real `console` object into this same env.
    if (this.deps.onConsoleMessage) {
      const consoleObj = globalEnv.get('console');
      onConsoleMessage(consoleObj, (entry) => this.deps.onConsoleMessage?.(entry));
    }

    // document.currentScript must reflect whichever <script> element is
    // synchronously executing right now (real self-configuring embed
    // scripts read their own data-* attributes off it), and null otherwise.
    // Fetched once since createGlobalEnv() only builds the document binding
    // once for the whole page — only the .value gets mutated per script below.
    const docBinding = globalEnv.get('document') as JSObject;
    const currentScriptDesc = docBinding.properties.get('currentScript')!;

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
    for (const { source, el } of blockingScripts) {
      if (signal.aborted) break;
      if (this.deps.scriptEnforcer) {
        const check = this.deps.scriptEnforcer.checkInlineScript(source, origin, baseUrl);
        if (!check.allowed) {
          console.warn(`[CSP] Blocked inline script: ${check.reason}`);
          continue;
        }
      }
      currentScriptDesc.value = wrapElement(el, domTree);
      const result2 = runJS(source, { document: doc, domTree, eventLoop, globalEnv });
      currentScriptDesc.value = null;
      if (result2.error) {
        console.error(
          `[ScriptEngine] Error executing blocking script: ${result2.error.message}`,
        );
      }
    }

    // 2. Execute defer scripts in document order (after DOM is parsed)
    for (const { source, el } of deferScripts) {
      if (signal.aborted) break;
      if (this.deps.scriptEnforcer) {
        const check = this.deps.scriptEnforcer.checkInlineScript(source, origin, baseUrl);
        if (!check.allowed) {
          console.warn(`[CSP] Blocked defer script: ${check.reason}`);
          continue;
        }
      }
      currentScriptDesc.value = wrapElement(el, domTree);
      const result2 = runJS(source, { document: doc, domTree, eventLoop, globalEnv });
      currentScriptDesc.value = null;
      if (result2.error) {
        console.error(
          `[ScriptEngine] Error executing defer script: ${result2.error.message}`,
        );
      }
    }

    // 3. Fire async scripts (best-effort — they may already be downloaded)
    for (const { source, el } of asyncScripts) {
      if (this.deps.scriptEnforcer) {
        const check = this.deps.scriptEnforcer.checkInlineScript(source, origin, baseUrl);
        if (!check.allowed) {
          console.warn(`[CSP] Blocked async script: ${check.reason}`);
          continue;
        }
      }
      // Fire and forget — async scripts don't block rendering
      currentScriptDesc.value = wrapElement(el, domTree);
      runJS(source, { document: doc, domTree, eventLoop, globalEnv });
      currentScriptDesc.value = null;
    }

    this.pageEventLoop = eventLoop;
    this.pageGlobalEnv = globalEnv;
    this.startEventLoopPump(eventLoop);
  }

  /**
   * Ticks the page's timer queue on a real ~60fps interval so setTimeout,
   * setInterval and requestAnimationFrame callbacks registered by page JS
   * keep firing after the initial synchronous script run finishes — not just
   * during it.
   */
  private startEventLoopPump(eventLoop: JsEventLoop): void {
    this.eventLoopPumpTimer = setInterval(() => {
      try {
        eventLoop.runOnce();
        // A fired callback may have mutated the DOM — request a frame so
        // the mutation (already queued via domTree) gets painted.
        this.reflowController?.requestFrame();
      } catch {
        // swallow — a broken timer callback shouldn't kill the pump
      }
    }, 16);
  }

  private stopEventLoopPump(): void {
    if (this.eventLoopPumpTimer !== null) {
      clearInterval(this.eventLoopPumpTimer);
      this.eventLoopPumpTimer = null;
    }
    this.pageEventLoop = null;
    this.pageGlobalEnv = null;
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

  // ── Form/link default-action helpers ────────────────────────────────
  // No tabindex concept exists anywhere in the engine yet — this is a
  // minimal tag-based stand-in.
  // ponytail: no tabindex support; add if a real page relies on it.

  private static isFocusable(el: DomElement): boolean {
    const tag = el.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button' || (tag === 'a' && el.attributes.has('href'));
  }

  private static isSubmitControl(tag: string, inputType: string): boolean {
    if (tag === 'input') return inputType === 'submit';
    if (tag === 'button') return inputType === '' || inputType === 'submit';
    return false;
  }

  /** Walks up .parent looking for a match — the internal-engine equivalent of the JS-exposed Element.prototype.closest(), operating on raw DomElements during dispatch rather than JS wrappers. */
  private static closestRaw(el: DomElement, predicate: (el: DomElement) => boolean): DomElement | null {
    let node: DomNode | null = el;
    while (node) {
      if (node.nodeType === 'element' && predicate(node as DomElement)) return node as DomElement;
      node = node.parent;
    }
    return null;
  }

  /** Every named form-control descendant of `form` — input/textarea/select, mirroring what collectFormEntries (js/index.ts) already walks for FormData. */
  private static collectFormFields(form: DomElement): DomElement[] {
    const fields: DomElement[] = [];
    const walk = (node: DomNode): void => {
      if (node.nodeType === 'element') {
        const el = node as DomElement;
        const tag = el.tagName.toLowerCase();
        if ((tag === 'input' || tag === 'textarea' || tag === 'select') && el.attributes.has('name')) {
          fields.push(el);
        }
      }
      for (const child of node.children) walk(child);
    };
    for (const child of form.children) walk(child);
    return fields;
  }

  /** required/pattern/min/max/minlength/maxlength — checked only at submit time. Returns a reason string if invalid, null if valid. Deliberately not exposed as .checkValidity()/.reportValidity() this phase. */
  private static validateField(el: DomElement): string | null {
    const tag = el.tagName.toLowerCase();
    const type = (el.attributes.get('type') ?? '').toLowerCase();
    const value = tag === 'select' ? PageRenderer.selectValue(el) : (el.value ?? el.attributes.get('value') ?? '');

    if (el.attributes.has('required')) {
      if (type === 'checkbox' && !(el.checked ?? el.attributes.has('checked'))) return 'required';
      if (type !== 'checkbox' && value === '') return 'required';
    }
    if (value === '') return null; // an optional, empty field skips the rest of the checks

    const pattern = el.attributes.get('pattern');
    if (pattern) {
      try { if (!new RegExp(`^(?:${pattern})$`).test(value)) return 'pattern'; } catch { /* invalid author-supplied pattern — ignore */ }
    }
    const minLength = el.attributes.get('minlength');
    if (minLength && value.length < Number(minLength)) return 'minlength';
    const maxLength = el.attributes.get('maxlength');
    if (maxLength && value.length > Number(maxLength)) return 'maxlength';
    if (type === 'number' || type === 'range') {
      const num = Number(value);
      const min = el.attributes.get('min');
      const max = el.attributes.get('max');
      if (min !== undefined && !Number.isNaN(num) && num < Number(min)) return 'min';
      if (max !== undefined && !Number.isNaN(num) && num > Number(max)) return 'max';
    }
    return null;
  }

  /** Mirrors dom-bindings.ts's <select> value getter — the value of the selected <option> (its value attribute, or its text content), duplicated rather than shared since that logic is a closure private to wrapElement(). */
  private static selectValue(el: DomElement): string {
    const options = el.children.filter((c): c is DomElement => c.nodeType === 'element' && (c as DomElement).tagName === 'option');
    if (options.length === 0) return '';
    let index = el.selectedIndex ?? -1;
    if (index < 0 || index >= options.length) {
      const preSelected = options.findIndex(o => o.attributes.has('selected'));
      index = preSelected >= 0 ? preSelected : 0;
    }
    const opt = options[index]!;
    return opt.attributes.get('value') ?? PageRenderer.textContentOf(opt);
  }

  /** Minimal text-content walk for a raw DomElement — mirrors dom-bindings.ts's module-private getTextContent(), duplicated since that one isn't exported. */
  private static textContentOf(el: DomElement): string {
    let text = '';
    for (const child of el.children) {
      if (child.nodeType === 'text') text += (child as DomNode & { text?: string }).text ?? '';
      else if (child.nodeType === 'element') text += PageRenderer.textContentOf(child as DomElement);
    }
    return text;
  }

  /**
   * Wraps the rules extractCss5RulesFromDocument() already returned in CSS5's
   * own shape (structured selectors, real sourceOrder, media/layer/container
   * nesting intact) into the CssStylesheet shape the cascade engine expects.
   */
  private buildCss5Stylesheet(rules: readonly Css5Rule[]): Css5Stylesheet {
    return { rules: [...rules], url: null };
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

      const rules = cssParser.extractCss5RulesFromDocument(parseResult.document);
      const stylesheet = this.buildCss5Stylesheet(rules);
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
    this.transitionEngine?.dispose();
    this.transitionEngine = null;
    this.reflowController?.dispose();
    this.reflowController = null;
    this.stopEventLoopPump();
  }

  /**
   * Runs `eventObj` through `target`'s own dispatchEvent (an element or
   * `window` — both are JSObjects with a compatible native dispatchEvent),
   * then drains microtasks and requests a repaint. Shared by every
   * dispatch*Event method below so the interpreter-caller/microtask/reflow
   * bookkeeping lives in exactly one place.
   */
  private runDispatch(target: JSObject, eventObj: JSObject): boolean {
    if (!this.pageEventLoop) return false;
    const dispatchFn = target.properties.get('dispatchEvent')?.value as JSFunction | undefined;
    if (!dispatchFn || dispatchFn.type !== 'closure') return false;

    // dispatchEvent's own body is a native function (runs directly), but the
    // page's `addEventListener` callbacks it invokes are real closures that
    // must go through the interpreter tied to this page's environment.
    const interpreter = this.pageEventLoop.getInterpreter();
    if (interpreter) setGlobalCaller(interpreter);
    try {
      callJSFunction(dispatchFn, target, [eventObj]);
    } finally {
      if (interpreter) setGlobalCaller(null);
    }
    // Let any promise reactions the handler kicked off settle immediately.
    this.pageEventLoop.drainMicrotasks();
    // The handler may have mutated the DOM (e.g. textContent) — those
    // mutations are only turned into a repaint on the next processed frame.
    this.reflowController?.requestFrame();
    return true;
  }

  /**
   * Hit-tests (x, y) against the live layout tree and, if it lands on an
   * element, wraps it back into its JS binding and dispatches a real
   * MouseEvent-shaped event of `type` — running any addEventListener
   * handlers page JS registered on it, exactly like a real browser's
   * click/pointer dispatch. Also used for 'dblclick'.
   */
  dispatchPointerEvent(type: string, x: number, y: number): boolean {
    const hitElement = this.deps.layoutEngine.getElementAtPoint(x, y);
    if (!hitElement) return false;
    const wrapped = wrapElement(hitElement, this.deps.domTree);
    const eventObj = createMouseEventObject(type, wrapped, { clientX: x, clientY: y }, { bubbles: true, cancelable: true });
    // Building the event object and running default actions needs no JS
    // environment — runDispatch (below) is the only part that requires one,
    // and it already no-ops safely without one. A page with zero <script>
    // tags must still support clicking a link or submitting a form; gating
    // ALL of this behind pageEventLoop (as a single early return used to)
    // would silently break every default action on any script-free page.
    const handled = this.runDispatch(wrapped, eventObj);

    if (type === 'click' && !eventObj.properties.get('defaultPrevented')?.value) {
      this.runClickDefaultAction(hitElement, wrapped);
    }
    return handled;
  }

  /**
   * Real-browser "default actions" a click on page content triggers once
   * page JS's own addEventListener handlers have run and not called
   * preventDefault() — none of this existed before: a checkbox never
   * toggled itself, a link never navigated, clicking never even focused
   * anything. Runs in this fixed priority order per click, matching real
   * browser behavior (a submit button inside an <a> would be unusual
   * authoring, but real browsers still only fire one default action).
   */
  private runClickDefaultAction(hitElement: DomElement, wrapped: JSObject): void {
    if (PageRenderer.isFocusable(hitElement)) this.deps.domTree.setFocusedElementId(hitElement.domId);

    const tag = hitElement.tagName.toLowerCase();
    const inputType = (hitElement.attributes.get('type') ?? '').toLowerCase();

    if (tag === 'input' && (inputType === 'checkbox' || inputType === 'radio')) {
      this.toggleCheckable(hitElement);
      this.runDispatch(wrapped, createEventObject('input', wrapped, { bubbles: true }));
      this.runDispatch(wrapped, createEventObject('change', wrapped, { bubbles: true }));
      return;
    }

    if (PageRenderer.isSubmitControl(tag, inputType)) {
      const form = PageRenderer.closestRaw(hitElement, (el) => el.tagName.toLowerCase() === 'form');
      if (form) this.submitForm(form);
      return;
    }

    const anchor = PageRenderer.closestRaw(hitElement, (el) => el.tagName.toLowerCase() === 'a' && el.attributes.has('href'));
    if (anchor && this.deps.controller) {
      const href = anchor.attributes.get('href')!;
      const url = this.currentPageUrl ? PageRenderer.resolveUrl(href, this.currentPageUrl) : href;
      void this.deps.controller.navigate(url);
    }
  }

  /**
   * Checkbox: flips .checked. Radio: sets .checked and un-checks every other
   * input[type=radio] sharing the same `name` — document-wide, since no
   * <form>-association exists yet to scope this by. Explicitly invalidates
   * paint for every element touched: these are raw DomElement field writes,
   * not domTree.setAttribute()-style mutations the reflow controller
   * observes on its own (the same reason the lazy-image-load path above
   * calls invalidatePaint()+requestFrame() by hand after an out-of-band
   * mutation) — without this, the checked glyph would only ever repaint as
   * an accidental side effect of some *other* dirty-marking (e.g. the
   * focus-change call just above), not reliably on every toggle.
   */
  private toggleCheckable(el: DomElement): void {
    const inputType = (el.attributes.get('type') ?? '').toLowerCase();
    if (inputType === 'radio') {
      const name = el.attributes.get('name');
      el.checked = true;
      this.reflowController?.invalidatePaint(el);
      if (name) {
        // ponytail: document-wide by name, not form-scoped — two unrelated
        // same-named radio groups on one page would incorrectly clear each
        // other. Upgrade path: scope by closest('form') once forms are
        // form-associated (tracked as a Phase 2d/roadmap follow-up).
        for (const other of this.deps.domTree.querySelectorAll('input[type="radio"]')) {
          if (other !== el && other.attributes.get('name') === name) {
            other.checked = false;
            this.reflowController?.invalidatePaint(other);
          }
        }
      }
    } else {
      el.checked = !(el.checked ?? el.attributes.has('checked'));
      this.reflowController?.invalidatePaint(el);
    }
    this.reflowController?.requestFrame();
  }

  /**
   * Form submission: reads every named field's current value (checkbox/
   * radio only when checked) into a real URLSearchParams binding.
   * required/pattern/min/max/minlength/maxlength are checked first; the
   * first invalid field blocks submission and gets focus, matching real
   * form behavior. GET (the default) appends the encoded fields to the
   * form's action URL; method="post" sends them as the request body
   * instead (application/x-www-form-urlencoded only — see the method
   * branch below for why multipart/form-data isn't here yet).
   */
  private submitForm(form: DomElement): void {
    if (!this.deps.controller) return;
    const fields = PageRenderer.collectFormFields(form);

    for (const field of fields) {
      const invalidReason = PageRenderer.validateField(field);
      if (invalidReason) {
        this.deps.domTree.setFocusedElementId(field.domId);
        return;
      }
    }

    const params = new URLSearchParams();
    for (const field of fields) {
      const name = field.attributes.get('name');
      if (!name) continue;
      const type = (field.attributes.get('type') ?? '').toLowerCase();
      const isChecked = field.checked ?? field.attributes.has('checked');
      if ((type === 'checkbox' || type === 'radio') && !isChecked) continue;
      const tag = field.tagName.toLowerCase();
      // Real HTML default: a checked checkbox/radio with no value="" attribute
      // submits as "on" (matches the already-correct logic in js/index.ts's
      // FormData-oriented collectFormEntries), not "".
      const checkableDefault = (type === 'checkbox' || type === 'radio') ? 'on' : '';
      const value = tag === 'select'
        ? PageRenderer.selectValue(field)
        : (field.value ?? field.attributes.get('value') ?? checkableDefault);
      params.append(name, value);
    }

    const action = form.attributes.get('action');
    const base = this.currentPageUrl ?? '';
    const targetUrl = action ? PageRenderer.resolveUrl(action, base) : base;
    if (!targetUrl) return;

    // GET (the default, and the only case when method is absent/anything
    // other than "post") appends the encoded fields as a query string.
    // POST sends the exact same URLSearchParams as the request body instead
    // — application/x-www-form-urlencoded only; multipart/form-data is a
    // separate, deliberate follow-up (MultipartBuilder exists and is ready,
    // but HttpRequestSpec.body is typed string, not the Uint8Array a real
    // multipart body needs — a genuine, independent type-plumbing task).
    const method = (form.attributes.get('method') ?? '').toLowerCase();
    if (method === 'post') {
      void this.deps.controller.navigate(targetUrl.split('#')[0], undefined, undefined, {
        method: 'POST',
        body: params.toString(),
      });
      return;
    }

    const query = params.toString();
    const url = query ? `${targetUrl.split('#')[0]}${targetUrl.includes('?') ? '&' : '?'}${query}` : targetUrl;
    void this.deps.controller.navigate(url);
  }

  /**
   * Dispatches a real KeyboardEvent-shaped event to the currently focused
   * element (falling back to <body> when nothing is focused, matching real
   * browser behavior), running any addEventListener handlers page JS
   * registered on it.
   */
  dispatchKeyEvent(
    type: string,
    key: string,
    code: string,
    modifiers?: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; repeat?: boolean },
  ): boolean {
    // See dispatchPointerEvent's comment: no early pageEventLoop return here
    // either, so text-editing/submit default actions still work on a
    // script-free page.
    const focusedId = this.deps.domTree.getFocusedElementId();
    const focusedNode = focusedId ? this.deps.domTree.getNodeById(focusedId) : null;
    const targetElement = (focusedNode && focusedNode.nodeType === 'element' ? focusedNode as DomElement : null)
      ?? this.deps.domTree.getDocument()?.bodyElement ?? null;
    if (!targetElement) return false;
    const wrapped = wrapElement(targetElement, this.deps.domTree);
    const eventObj = createKeyboardEventObject(type, wrapped, { key, code, ...modifiers }, { bubbles: true, cancelable: true });
    const handled = this.runDispatch(wrapped, eventObj);

    if (type === 'keydown' && !eventObj.properties.get('defaultPrevented')?.value) {
      this.runKeyDefaultAction(targetElement, wrapped, key);
    }
    return handled;
  }

  /**
   * Real-browser text-editing default action: typing into a focused input/
   * textarea previously did nothing but fire the event — nothing edited
   * .value or moved a caret. textarea's Enter always inserts a newline;
   * a plain input's Enter submits its form instead (never inserts \n),
   * disambiguated by tag alone — no shared flag needed since a value can
   * only be one tag at a time.
   */
  private runKeyDefaultAction(targetElement: DomElement, wrapped: JSObject, key: string): void {
    const tag = targetElement.tagName.toLowerCase();
    const inputType = (targetElement.attributes.get('type') ?? '').toLowerCase();
    const isTextArea = tag === 'textarea';
    const isTextInput = tag === 'input' && ['', 'text', 'search', 'url', 'tel', 'password', 'email', 'number'].includes(inputType);
    if (!isTextArea && !isTextInput) return;

    if (key === 'Enter' && isTextInput) {
      const form = PageRenderer.closestRaw(targetElement, (el) => el.tagName.toLowerCase() === 'form');
      if (form) this.submitForm(form);
      return; // a real <input> never inserts a newline, form or no form
    }

    if (PageRenderer.editValueAtCaret(targetElement, key)) {
      // Explicit invalidatePaint()+requestFrame(), same reasoning as
      // toggleCheckable() above — .value is a raw DomElement field write,
      // not a domTree-observed mutation, so nothing else would reliably
      // schedule a repaint of the newly-typed text.
      this.reflowController?.invalidatePaint(targetElement);
      this.reflowController?.requestFrame();
      this.runDispatch(wrapped, createEventObject('input', wrapped, { bubbles: true }));
    }
  }

  /**
   * Splices `key` into targetElement.value at .caretOffset (Backspace/Delete
   * remove instead), and moves the caret for Left/Right/Home/End. Returns
   * true only when .value actually changed (so the caller knows whether to
   * fire 'input' — pure caret movement doesn't). No selection/range concept
   * (shift+arrow, drag-select) this phase — see the plan's deferred list.
   */
  private static editValueAtCaret(el: DomElement, key: string): boolean {
    // A <textarea>'s initial content is its text content, not a value=""
    // attribute (mirrors the identical seeding logic in dom-bindings.ts's
    // value getter).
    const value = el.value ?? (el.tagName.toLowerCase() === 'textarea' ? PageRenderer.textContentOf(el) : el.attributes.get('value')) ?? '';
    let caret = el.caretOffset ?? value.length;
    caret = Math.max(0, Math.min(caret, value.length));

    if (key === 'ArrowLeft') { el.caretOffset = Math.max(0, caret - 1); return false; }
    if (key === 'ArrowRight') { el.caretOffset = Math.min(value.length, caret + 1); return false; }
    if (key === 'Home') { el.caretOffset = 0; return false; }
    if (key === 'End') { el.caretOffset = value.length; return false; }

    if (key === 'Backspace') {
      if (caret === 0) return false;
      el.value = value.slice(0, caret - 1) + value.slice(caret);
      el.caretOffset = caret - 1;
      return true;
    }
    if (key === 'Delete') {
      if (caret >= value.length) return false;
      el.value = value.slice(0, caret) + value.slice(caret + 1);
      el.caretOffset = caret;
      return true;
    }
    // By this point (a plain <input>'s Enter is intercepted earlier in
    // runKeyDefaultAction, before it ever reaches here), Enter can only mean
    // a <textarea> newline.
    const insert = key === 'Enter' ? '\n' : (key.length === 1 ? key : null); // every other named special key ("Shift", "ArrowLeft", ...) is longer than 1 char
    if (insert !== null) {
      el.value = value.slice(0, caret) + insert + value.slice(caret);
      el.caretOffset = caret + insert.length;
      return true;
    }
    return false;
  }

  /**
   * Hit-tests (x, y) against the live layout tree and dispatches a real
   * WheelEvent-shaped event to whatever element is there. Does not itself
   * scroll anything — page-renderer has no viewport pan/repaint mechanism
   * yet, so this only delivers the event to page JS `addEventListener`
   * handlers, same limitation as every other event here already had.
   */
  dispatchWheelEvent(x: number, y: number, deltaX: number, deltaY: number): boolean {
    if (!this.pageEventLoop) return false;
    const hitElement = this.deps.layoutEngine.getElementAtPoint(x, y);
    if (!hitElement) return false;
    const wrapped = wrapElement(hitElement, this.deps.domTree);
    const eventObj = createWheelEventObject('wheel', wrapped, { deltaX, deltaY }, { bubbles: true, cancelable: true });
    return this.runDispatch(wrapped, eventObj);
  }

  /** Dispatches a real 'resize' event on `window`, running any addEventListener handlers page JS registered there. */
  dispatchResizeEvent(): boolean {
    if (!this.pageEventLoop || !this.pageGlobalEnv) return false;
    const windowObj = this.pageGlobalEnv.get('window') as JSObject | undefined;
    if (!windowObj) return false;
    const eventObj = createEventObject('resize', windowObj, { bubbles: false, cancelable: false });
    return this.runDispatch(windowObj, eventObj);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export { PageLoader } from './page-loader';
export { PageRenderer };
export type { PageRendererDependencies };
