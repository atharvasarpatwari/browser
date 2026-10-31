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
  CssMediaQuery,
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
import { computeComputedStyles, computePseudoElementStyles, collectKeyframes, evaluatePrefersReducedMotion } from '../rendering/css5/cascade';
import { makePseudoElement, applyCounterProperties, insideMarker, type Counters } from '../rendering/generated-content';
import { buildUsedStyle } from '../rendering/css5/used-style';
import { runJS, createGlobalEnv } from '../js/index';
import { getPreferredColorScheme } from '../rendering/color-scheme';
import { EventLoop as JsEventLoop } from '../js/event-loop';
import { HtmlSanitizer } from '../security/html-sanitizer';
import type { CspScriptEnforcer } from '../security/csp-script-enforcer';
import type { CspPolicyStore } from '../security/csp-policy-store';
import type { ICorsEngine } from '../security/cors';
import { parseOrigin, OPAQUE_ORIGIN } from '../security/origin-service';
import type { SecurityLayer } from '../media/security-layer';
import { ReflowRepaintController } from '../rendering/reflow-repaint-controller';
import { renderInlineSvgs, type SvgDecode } from '../rendering/inline-svg';
import { ImageDecoder } from '../image/decoder';
import type { LayerCompositor } from '../rendering/compositing/layer-compositor';
import { CssAnimationAnimator } from '../rendering/css-animations';
import { setAnimationRuntime, dispatchAnimationEventToElement, dispatchDomEvent } from '../js/dom-bindings';

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
  /** Optional callback invoked once per page load, after the document is parsed, scripted, laid out and painted. */
  readonly onDocumentReady?: (url: string, doc: DomDocument) => void;
  /** Rasterizes standalone SVG markup (inline `<svg>`); default: the platform image decoder. */
  readonly svgDecode?: SvgDecode;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONCRETE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

/** Total time all of a page's scripts may take before the rest are skipped. */
const PAGE_SCRIPT_BUDGET_MS = 3000;

/**
 * The root's default text colour (the `CanvasText` system colour) resolved for the page's colour
 * scheme: white when the page opts into dark (`color-scheme: light dark` / `dark`) and the user
 * prefers dark, black otherwise. The keyword was never resolved (it only came out black because
 * unknown colours fall back to black), so example.com in dark mode was black text on #222.
 */
function applyDarkCanvasText(root: Map<string, string>): void {
  const color = (root.get('color') ?? '').replace(/\s+/g, '').toLowerCase();
  if (color !== '' && color !== 'canvastext') return; // the page chose its own colour
  const scheme = (root.get('color-scheme') ?? '').toLowerCase();
  const dark = /\bdark\b/.test(scheme) && getPreferredColorScheme() === 'dark';
  root.set('color', dark ? '#ffffff' : '#000000');
}

class PageRenderer implements IPageRenderer, IDisposable {
  private readonly deps: PageRendererDependencies;
  /** Layout viewport in CSS px. Desktop keeps the 1920×1080 default; the Android shell sets the phone's size. */
  private viewport = { width: 1920, height: 1080 };
  private lastDocument: DomDocument | null = null;

  /** Text of the document's <title> (the first one outside <svg>), whitespace collapsed. */
  getDocumentTitle(): string {
    const doc = this.lastDocument;
    if (!doc) return '';
    const find = (node: DomElement): DomElement | null => {
      for (const child of node.children) {
        if (child.nodeType !== 'element') continue;
        const el = child as DomElement;
        const tag = el.tagName.toLowerCase();
        if (tag === 'title') return el;
        if (tag === 'svg' || tag === 'math') continue;
        const hit = find(el);
        if (hit) return hit;
      }
      return null;
    };
    const title = doc.htmlElement ? find(doc.htmlElement as DomElement) : null;
    if (!title) return '';
    const text = (title.children as readonly { nodeType: string; text?: string }[])
      .map((c) => (c.nodeType === 'text' ? c.text ?? '' : '')).join('');
    return text.replace(/\s+/g, ' ').trim();
  }
  private disposed = false;
  private reflowController: ReflowRepaintController | null = null;
  private transitionEngine: CssTransitionEngine | null = null;

  constructor(deps: PageRendererDependencies) {
    this.deps = deps;
  }

  /**
   * Lays pages out at `width`×`height` CSS px and paints them at `devicePixelRatio`, so a
   * phone gets a phone-width page (readable text, its own @media rules) drawn at native
   * resolution instead of a 1920-wide desktop page shrunk to fit. Re-lays out the current
   * page when the size changes.
   */
  setViewport(width: number, height: number, devicePixelRatio = 1): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (w === this.viewport.width && h === this.viewport.height && devicePixelRatio === this.dpr) return;
    this.viewport = { width: w, height: h };
    this.dpr = devicePixelRatio;
    this.deps.layoutEngine.updateConfig({ viewportWidth: w, viewportHeight: h });
    this.deps.paintEngine.updateConfig({ width: w, height: h, devicePixelRatio });
    const doc = this.lastDocument;
    if (!doc || this.disposed) return;
    this.applyComputedStyles(this._lastRules);
    this.deps.layoutEngine.layout(doc, this.deps.domTree);
    this.deps.paintEngine.paint(doc);
    this.deps.domTree.clearMutations();
    this.initReflowController(doc);
    this.deps.onFrameRendered?.();
  }

  getViewport(): { width: number; height: number } {
    return { ...this.viewport };
  }

  private dpr = 1;

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

    // Phase timings, logged once per page (on Android they reach logcat): the only way to see
    // where a slow page's time goes on a device.
    const timings: string[] = [];
    let mark = performance.now();
    const lap = (name: string): void => {
      const now = performance.now();
      timings.push(`${name} ${Math.round(now - mark)}`);
      mark = now;
    };

    // 1. Parse HTML
    const parseResult = htmlParser.parse(result.body, result.url);
    const htmlDoc = parseResult.document;

    // 2. Submit discovered resources to the prioritizer for batch loading
    if (parseResult.resources.length > 0) {
      prioritizer.submitBatch(parseResult.resources);
    }

    // 3. Convert the parsed HTML into our internal DOM tree representation
    const doc = domTree.buildFromHtml(htmlDoc);
    this.lastDocument = doc;

    // 3b. Sanitize DOM tree — strip dangerous elements and attributes
    if (this.deps.sanitizer) {
      this.deps.sanitizer.sanitize(doc, domTree);
    }

    // 4. Extract and compute CSS styles (fetching <link rel=stylesheet> sheets first)
    lap('html');
    const rules = await this.loadExternalStylesheets(cssParser.extractStylesFromDocument(htmlDoc), result.url, signal);
    lap('css');
    this._lastRules = rules;
    this.applyComputedStyles(rules);
    lap('style');

    // 5. Execute scripts: inline synchronously, external fetched via ResourceLoader.
    //    Paint the script-free page first, so a slow script never delays seeing it;
    //    the full layout+paint below then picks up whatever the scripts changed.
    if (domTree.getElementsByTagName('script').length > 0) {
      layoutEngine.layout(doc, domTree);
      lap('layout');
      paintEngine.paint(doc);
      lap('paint');
      this.deps.onFrameRendered?.();
      lap('frame');
      await this.executeAllScripts(doc, result.url, signal);
      lap('scripts');
      // Re-read <style> from the live DOM: scripts add and edit stylesheets (example.com's s.js
      // inserts its p+p/svg rules). Re-applying the pre-script rules ignored all of that.
      this._lastRules = this.rulesFromDomStyles(rules);
      this.applyComputedStyles(this._lastRules);
      lap('style2');
    }

    // 6. Run layout
    layoutEngine.layout(doc, domTree);
    lap('layout2');

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
    lazyLoader.setViewport(this.viewport.width, this.viewport.height);

    // 8. Paint
    paintEngine.paint(doc);
    lap('paint2');
    console.info(`[render] ${timings.join(' · ')} ms — ${result.url.slice(0, 120)}`);

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
    // Inline <svg> (logos, icons) painted nothing: rasterize each through the image decoder.
    const svgCount = await renderInlineSvgs(doc.children, this.svgDecode, this.dpr);
    if (iframeCount > 0 || svgCount > 0) {
      // Full repaint so embedded frames appear in the very first rasterized
      // output rather than waiting for an incremental reflow frame.
      paintEngine.paint(doc);
      domTree.clearMutations();
    }

    // 11. Wire the incremental reflow/repaint controller for post-load DOM
    //     mutations (JS-triggered changes, scroll/scroll-triggered relayout).
    this.initReflowController(doc);

    // 12. Tell interested parties (e.g. the personal search archive) the document is ready.
    try {
      this.deps.onDocumentReady?.(result.url, doc);
    } catch {
      // An observer must never break page rendering.
    }
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
      viewportWidth: this.viewport.width,
      viewportHeight: this.viewport.height,
    });
    controller.init(doc);
    // Incremental style recalc resolves _dirtyStyle nodes before layout.
    controller.setStyleRecalcCallback(() => this.recalcStylesIncremental());
    // Notify the UI (via the engine) when a reflow frame repaints the page.
    controller.setFrameCallback(() => {
      this.deps.onFrameRendered?.();
      // Svgs shown, inserted, resized or recoloured since: draw them (one pass at a time).
      // ponytail: walks the DOM for svgs each frame; index them if that shows in profiles.
      if (this.svgPass || this.disposed) return;
      this.svgPass = renderInlineSvgs(doc.children, this.svgDecode, this.dpr)
        .then((n) => { this.svgPass = null; if (n > 0 && !this.disposed) this.requestReflow(); }, () => { this.svgPass = null; });
    });
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
  /** Rules from the document's current <style> elements, plus the original external-sheet entries. */
  private rulesFromDomStyles(original: readonly CssRule[]): readonly CssRule[] {
    const { domTree, cssParser } = this.deps;
    const fromStyles = domTree.getElementsByTagName('style').flatMap((el) => {
      const css = el.children.map((c) => (c.nodeType === 'text' ? (c as { text?: string }).text ?? '' : '')).join('');
      return css.trim() ? cssParser.parseStylesheet(css).rules : [];
    });
    // External sheets first: <link>s normally precede the page's own <style> in <head>.
    return [...original.filter((r) => r.source === 'external'), ...fromStyles];
  }

  /**
   * Fetches each <link rel=stylesheet> and splices its rules in at the link's position.
   * They used to stay "__external__" placeholders that nothing loaded, so sites that keep
   * their CSS in files (nearly all of them) rendered unstyled. Render-blocking, as in browsers.
   * The link's media attribute and @import media lists wrap the sheet's rules, so the cascade
   * applies them only where they match. ponytail: CSP style-src isn't applied to sheets yet.
   */
  private async loadExternalStylesheets(rules: readonly CssRule[], baseUrl: string, signal: AbortSignal): Promise<readonly CssRule[]> {
    const expanded = await Promise.all(rules.map(async (rule): Promise<readonly CssRule[]> => {
      if (rule.selector !== '__external__' || !rule.sourceUrl) return [rule];
      const url = PageRenderer.resolveUrl(rule.sourceUrl, baseUrl);
      return [rule, ...await this.fetchStylesheet(url, baseUrl, rule.media ?? [], new Set(), signal)];
    }));
    return expanded.flat();
  }

  /**
   * One sheet plus its @imports, in cascade order: imported sheets first (they sit at the top of
   * the importing sheet), then its own rules. `media` holds the enclosing link/import media lists.
   */
  private async fetchStylesheet(
    url: string,
    pageUrl: string,
    media: readonly (readonly CssMediaQuery[])[],
    seen: Set<string>,
    signal: AbortSignal,
  ): Promise<CssRule[]> {
    const { resourceLoader, cssParser, securityLayer } = this.deps;
    if (seen.has(url) || seen.size >= 16) return []; // @import cycles and runaway chains
    seen.add(url);
    if (securityLayer && !securityLayer.checkSubresource(pageUrl, url, 'style').allowed) {
      console.warn(`[Security] Blocked stylesheet: ${url}`);
      return [];
    }
    let css: string;
    try {
      css = await resourceLoader.loadStylesheet(url);
    } catch (err) {
      console.warn(`[CSS] Failed to load stylesheet ${url}:`, err instanceof Error ? err.message : err);
      return [];
    }
    if (signal.aborted || !css) return [];

    const imports = (cssParser as CssParser).getCss5Parser().parseStylesheetRobust(css, url).rules
      .filter((r): r is Extract<Css5Rule, { type: 'import' }> => r.type === 'import');
    const imported = await Promise.all(imports.map((imp) => this.fetchStylesheet(
      PageRenderer.resolveUrl(imp.url, url), pageUrl,
      imp.mediaQueries.length > 0 && !imp.mediaQueries.every((q) => q.mediaType === 'all' && q.features.length === 0 && !q.modifier)
        ? [...media, imp.mediaQueries] : media,
      seen, signal)));
    const own = cssParser.parseStylesheet(css, url).rules.map((r) => ({
      ...r,
      source: 'external' as const,
      ...(media.length > 0 ? { media: [...media, ...(r.media ?? [])] } : {}),
    }));
    return [...imported.flat(), ...own];
  }

  private applyComputedStyles(rules: readonly CssRule[]): void {
    const { domTree, cssParser } = this.deps;
    const doc = domTree.getDocument();
    if (!doc) return;

    // Build a CSS5 stylesheet from legacy CssRule[] (reparse selectors once).
    const stylesheet = this.buildCss5Stylesheet(cssParser, rules);
    this._lastStylesheet = stylesheet;

    // Determine container dimensions for percentage-based used-style resolution.
    const bodyEl = doc.bodyElement;
    const containerWidth = bodyEl?.layoutBox?.width ?? this.viewport.width;
    const containerHeight = bodyEl?.layoutBox?.height ?? this.viewport.height;

    // Pass 1: Build StyleableElement tree mirroring the DOM tree.
    const rootStyleables = this.buildStyleableTree(doc.children, null);

    // Pass 2: Compute and apply styles top-down (document order, which CSS counters follow).
    this.counters = new Map();
    this.applyStylesRecursive(doc.children, rootStyleables, stylesheet, null, containerWidth, containerHeight, domTree);
    this.counters = null;
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
    const containerWidth = bodyEl?.layoutBox?.width ?? this.viewport.width;
    const containerHeight = bodyEl?.layoutBox?.height ?? this.viewport.height;

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
        this.viewport,
        parentComputed,
      );
      // The root again gets the dark scheme's text colour: restyled here without it, example.com
      // in dark mode went back to black text on #222 after its first reflow (seen on the phone).
      if (!parentComputed) applyDarkCanvasText(computed);
      // A changed style needs layout and paint again: the element kept its cached paint commands,
      // so `el.style.background = …` from a click handler never showed (seen on the tablet).
      const previous = el.computedStyle;
      if (!previous || previous.size !== computed.size || [...computed].some(([k, v]) => previous.get(k) !== v)) {
        domTree.markDirty(el, 'layout'); // and its ancestors, so incremental layout reaches it
        el._dirtyPaint = true;
      }
      domTree.setComputedStyle(el, computed);

      const usedStyle = buildUsedStyle(computed, containerWidth, containerHeight, 16);
      domTree.setUsedStyle(el, usedStyle);
      this.applyPseudoElements(el, styleable, stylesheet, computed, containerWidth, containerHeight);

      domTree.clearDirty(el, 'style');
    }
  }

  private _lastRules: readonly CssRule[] = [];
  /** The current page's script event loop (null for pages without scripts). */
  private pageEventLoop: JsEventLoop | null = null;
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
    const { domTree, resourceLoader, scriptEnforcer } = this.deps;
    this.pageEventLoop = null; // never dispatch into the previous page's scripts
    const scripts = domTree.getElementsByTagName('script');
    if (scripts.length === 0) return;

    // Canonical page origin for CSP lookups and CORS checks (scheme://host[:port]).
    const origin = parseOrigin(baseUrl);

    const eventLoop = new JsEventLoop();
    this.pageEventLoop = eventLoop;
    eventLoop.onWake = () => this.schedulePagePump();
    // One global environment per page: what one script defines (e.g. a library)
    // must be visible to the scripts after it, as in a browser.
    const env = createGlobalEnv(
      doc, domTree, eventLoop, this.deps.controller, undefined,
      this.deps.resourceEnforcer, scriptEnforcer, origin, this.deps.htmlParser,
      this.deps.storageDir, this.deps.corsEngine,
      () => ({ ...this.viewport, dpr: this.dpr }),
    );

    type Entry = { source: string; inline: boolean; nonce?: string };
    const blockingScripts: Entry[] = [];
    const deferScripts: Entry[] = [];
    const asyncScripts: Entry[] = [];

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

        // CSP script-src for an external script is decided by its URL (not as inline code).
        if (scriptEnforcer) {
          const check = scriptEnforcer.checkExternalScript(fullUrl, origin, baseUrl);
          if (!check.allowed) {
            console.warn(`[CSP] Blocked external script: ${fullUrl} (${check.reason})`);
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

          const entry: Entry = { source, inline: false };
          if (isAsync) {
            asyncScripts.push(entry);
          } else if (isDefer) {
            deferScripts.push(entry);
          } else {
            blockingScripts.push(entry);
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
        blockingScripts.push({ source, inline: true, nonce: script.attributes.get('nonce') ?? undefined });
      }
    }

    // ponytail: one total budget per page (each script is also capped at 5 s by the
    // interpreter); scripts past it are skipped. Upgrade path: yield and resume later.
    const deadline = Date.now() + PAGE_SCRIPT_BUDGET_MS;
    let skipped = 0;
    const run = (entry: Entry, kind: string): void => {
      if (Date.now() > deadline) { skipped++; return; }
      if (entry.inline && scriptEnforcer) {
        const check = scriptEnforcer.checkInlineScript(entry.source, origin, baseUrl, entry.nonce);
        if (!check.allowed) {
          console.warn(`[CSP] Blocked ${kind} script: ${check.reason}`);
          return;
        }
      }
      const result = runJS(entry.source, { document: doc, domTree, eventLoop, globalEnv: env, htmlParser: this.deps.htmlParser });
      if (result.error) {
        console.error(`[ScriptEngine] Error executing ${kind} script: ${result.error.message}`);
      }
    };

    // 1. Blocking scripts in document order, 2. defer scripts (after the DOM is
    //    parsed), 3. async scripts (best-effort: already downloaded by now).
    for (const entry of blockingScripts) { if (signal.aborted) return; run(entry, 'blocking'); }
    for (const entry of deferScripts) { if (signal.aborted) return; run(entry, 'defer'); }
    for (const entry of asyncScripts) { if (signal.aborted) return; run(entry, 'async'); }
    // 4. DOMContentLoaded, then load. Neither was ever fired, so scripts that wire their UI there
    //    (httpforever's theme and colour buttons) registered no handlers and taps did nothing.
    // ponytail: load fires with DOMContentLoaded, before images finish; it should wait for them.
    if (!signal.aborted && blockingScripts.length + deferScripts.length + asyncScripts.length > 0) {
      const ready = runJS(
        "document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));" +
        "window.dispatchEvent(new Event('load'));" +
        "if (typeof window.onload === 'function') window.onload(new Event('load'));",
        { document: doc, domTree, eventLoop, globalEnv: env, htmlParser: this.deps.htmlParser },
      );
      if (ready.error) console.error(`[ScriptEngine] Error in a DOMContentLoaded/load listener: ${ready.error.message}`);
    }
    if (skipped > 0) {
      console.warn(`[ScriptEngine] Page script budget (${PAGE_SCRIPT_BUDGET_MS} ms) used up; skipped ${skipped} script(s) on ${baseUrl}`);
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
      // Re-wrap @media rules so the cascade evaluates them against the viewport.
      let wrapped: Css5Rule = styleRule;
      for (const mediaQueries of [...(rule.media ?? [])].reverse()) {
        wrapped = { type: 'media', mediaQueries, rules: [wrapped] };
      }
      css5Rules.push(wrapped);
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
  private svgPass: Promise<void> | null = null;
  private readonly svgDecode: SvgDecode = (markup) => this.deps.svgDecode
    ? this.deps.svgDecode(markup)
    : new ImageDecoder().decode(new TextEncoder().encode(markup), 'image/svg+xml');

  /** CSS counters during the full style pass (null otherwise: incremental restyles keep their text). */
  private counters: Counters | null = null;

  /** The element's ::before / ::after boxes (generated-content.ts); they were never rendered. */
  private applyPseudoElements(
    el: DomElement,
    styleable: StyleableElement,
    stylesheet: Css5Stylesheet,
    computed: Map<string, string>,
    containerWidth: number,
    containerHeight: number,
  ): void {
    const counters = this.counters ?? undefined;
    if (counters) applyCounterProperties(computed, counters);
    for (const pseudo of ['before', 'after'] as const) {
      const style = computePseudoElementStyles(styleable, pseudo, stylesheet, this.viewport, computed);
      if (style && counters) applyCounterProperties(style, counters);
      const box = style ? makePseudoElement(el, pseudo, style, counters)
        : pseudo === 'before' ? insideMarker(el, computed) : null;
      if (box) box.usedStyle = buildUsedStyle(box.computedStyle!, containerWidth, containerHeight, 16);
      if (pseudo === 'before') el.pseudoBefore = box;
      else el.pseudoAfter = box;
    }
  }

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
        this.viewport,
        parentComputed ?? undefined,
      );
      if (!parentComputed) applyDarkCanvasText(computed);
      domTree.setComputedStyle(el, computed);

      // Build used style for faster layout
      const used = buildUsedStyle(computed, containerWidth, containerHeight, 16);
      domTree.setUsedStyle(el, used);
      this.applyPseudoElements(el, styleable, stylesheet, computed, containerWidth, containerHeight);

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

  private pumpTimer: ReturnType<typeof setTimeout> | null = null;
  private pumpAt = Infinity;

  /**
   * Arrange for the page's queued work (timers, settled fetches/promises) to run. Nothing ran the
   * page's event loop after load, so setTimeout/setInterval callbacks never fired and promise
   * callbacks from fetch responses waited forever.
   */
  private schedulePagePump(): void {
    const loop = this.pageEventLoop;
    if (!loop || this.disposed) return;
    const wait = loop.microtaskCount + loop.nextTickCount > 0 ? 0 : loop.timeUntilNext();
    if (!Number.isFinite(wait)) return;
    const at = Date.now() + wait;
    if (this.pumpTimer && at >= this.pumpAt) return;
    if (this.pumpTimer) clearTimeout(this.pumpTimer);
    this.pumpAt = at;
    this.pumpTimer = setTimeout(() => this.pumpPage(loop), Math.min(wait, 0x7fffffff));
    (this.pumpTimer as { unref?: () => void }).unref?.(); // Node: page timers must not keep the process alive
  }

  /** Run what is due on the page's event loop, then repaint if the scripts changed the DOM. */
  private pumpPage(loop: JsEventLoop): void {
    this.pumpTimer = null;
    this.pumpAt = Infinity;
    if (loop !== this.pageEventLoop || this.disposed) return;
    const mutations = () => this.deps.domTree.mutationCount ?? this.deps.domTree.getMutations().length;
    const before = mutations();
    loop.runWithInterpreter(() => {
      // Due timers, a bounded number per pump so a tight setInterval cannot starve the UI.
      for (let i = 0; i < 50; i++) {
        loop.runOnce(Date.now());
        if (loop.pendingCount === 0 || loop.timeUntilNext() > 0) break;
      }
    });
    if (mutations() !== before) this.requestReflow();
    this.schedulePagePump();
  }

  /** Redraw one element whose look changed outside layout (a form control's checked state). */
  repaintElement(el: DomElement): void {
    this.reflowController?.invalidatePaint(el);
    this.requestReflow();
  }

  /** Fires a UI event (e.g. a tap's click) into the page's scripts, then repaints what they changed. */
  dispatchPageEvent(el: DomElement, type: string): boolean {
    const fire = (): boolean => dispatchDomEvent(el, type, this.deps.domTree);
    const notCanceled = this.pageEventLoop ? this.pageEventLoop.runWithInterpreter(fire) : fire();
    this.reflowController?.invalidatePaint(el);
    this.requestReflow();
    return notCanceled;
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
    if (this.pumpTimer) clearTimeout(this.pumpTimer);
    this.pumpTimer = null;
    setAnimationRuntime(null);
    this.transitionEngine?.dispose();
    this.transitionEngine = null;
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
