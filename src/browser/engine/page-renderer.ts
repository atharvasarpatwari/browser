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
import type { IResourceLoader } from '../netwroking/resource-loader';
import type { IDomTree, DomNode, DomElement, DomDocument } from '../rendering/dom-tree';
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
import { ResourcePrioritizer } from '../netwroking/resource-prioritizer';
import { computeComputedStyles } from '../rendering/css5/cascade';
import { runJS } from '../js/index';
import { EventLoop as JsEventLoop } from '../js/event-loop';
import { HtmlSanitizer } from '../security/html-sanitizer';
import type { CspScriptEnforcer } from '../security/csp-script-enforcer';

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
}

// ─────────────────────────────────────────────────────────────────────────────
// CONCRETE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

class PageRenderer implements IPageRenderer, IDisposable {
  private readonly deps: PageRendererDependencies;
  private disposed = false;

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
    this.applyComputedStyles(rules);

    // 5. Execute scripts: inline synchronously, external fetched via ResourceLoader
    await this.executeAllScripts(doc, result.url, signal);
    this.applyComputedStyles(rules); // Re-apply after script execution

    // 6. Run layout
    layoutEngine.layout(doc, domTree);

    // 7. Lazy load images/iframes via IntersectionObserver
    const lazyLoader = new LazyLoader();
    lazyLoader.init(doc, domTree);
    lazyLoader.scanForLazyElements(doc);
    lazyLoader.setViewport(1920, 1080); // Default viewport

    // 8. Paint
    paintEngine.paint(doc);
  }

  // ── Private Helper Methods ──────────────────────────────────────────────

  /**
   * Walks the DOM tree, builds a StyleableElement mirror for CSS5 selector
   * matching, and applies computed styles to every element so the layout /
   * paint engines can consume them via node.computedStyle.
   */
  private applyComputedStyles(rules: readonly CssRule[]): void {
    const { domTree, cssParser } = this.deps;
    const doc = domTree.getDocument();
    if (!doc) return;

    // Build a CSS5 stylesheet from legacy CssRule[] (reparse selectors once).
    const stylesheet = this.buildCss5Stylesheet(cssParser, rules);

    // Pass 1: Build StyleableElement tree mirroring the DOM tree.
    const rootStyleables = this.buildStyleableTree(doc.children, null);

    // Pass 2: Compute and apply styles top-down.
    this.applyStylesRecursive(doc.children, rootStyleables, stylesheet, null);
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

        try {
          const source = await resourceLoader.loadScript(fullUrl);

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
      const result2 = runJS(source, { document: doc, domTree, eventLoop, controller: this.deps.controller, resourceEnforcer: this.deps.resourceEnforcer, pageOrigin: baseUrl });
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
      const result2 = runJS(source, { document: doc, domTree, eventLoop, controller: this.deps.controller, resourceEnforcer: this.deps.resourceEnforcer, pageOrigin: baseUrl });
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
      runJS(source, { document: doc, domTree, eventLoop, controller: this.deps.controller, resourceEnforcer: this.deps.resourceEnforcer, pageOrigin: baseUrl });
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
  ): void {
    const { domTree } = this.deps;
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

      // Recurse into children with this element's computed styles as parent.
      this.applyStylesRecursive(
        el.children,
        styleable.children,
        stylesheet,
        computed,
      );
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

  // ── Dispose ──────────────────────────────────────────────────────────────

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export { PageLoader } from './page-loader';
export { PageRenderer };
export type { PageRendererDependencies };
