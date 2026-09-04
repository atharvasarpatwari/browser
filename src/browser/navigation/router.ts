/**
 * @file src/browser/navigation/router.ts
 * @session 4
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Map every committed NavigationEntry to the correct page handler.
 *
 * The Router is the switching layer between the NavigationController
 * (which decides WHERE to go) and the rendering pipeline (which decides
 * HOW to display it).  Nothing in either layer needs to know about the other.
 *
 *   NavigationController
 *        │  emits "navigationCommitted"
 *        ▼
 *      Router.match(entry)          ← pattern + priority lookup
 *        │  returns RouteMatch
 *        ▼
 *      Router.dispatch(entry)       ← calls the matched handler
 *        │  returns RouteResult
 *        ▼
 *   BrowserEngine / UI
 *        (next sessions)
 *
 * Built-in routes (registered automatically in the constructor):
 *   about:blank          → BlankPage
 *   about:newtab         → NewTabPage
 *   nova://settings      → InternalPage  (id = "settings")
 *   nova://downloads     → InternalPage  (id = "downloads")
 *   nova://history       → InternalPage  (id = "history")
 *   nova://bookmarks     → InternalPage  (id = "bookmarks")
 *   nova://extensions    → InternalPage  (id = "extensions")
 *   https: (protocol)    → WebContent
 *   http:  (protocol)    → WebContent
 *   file:  (protocol)    → LocalFile
 *   ftp:   (protocol)    → WebContent
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 *  Abstraction      IRouter is the only type callers depend on.
 *  Encapsulation    Route storage, priority sort, and pattern tests are all
 *                   private — no consumer can bypass the matching pipeline.
 *  Single-Resp.     Router only routes.  It never fetches, renders, or stores.
 *  Open / Closed    New routes are added via register() without modifying the
 *                   Router class itself.
 *  Dependency-Inv.  Router receives INavigationController; never constructs it.
 *  Interface-Seg.   IRouter is lean; the full Route descriptor stays internal.
 */

import type { ParsedUrl } from './url-parser';
import type {
  NavigationEntry,
  INavigationController,
  NavigationEvent,
} from './navigation-controller';
import {
  GatewayProtocolManager,
  GatewayCategory,
} from '../networking/gateway-protocols';

// ─────────────────────────────────────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The broad category of page a route resolves to.
 * Used by the rendering pipeline to decide which view layer to activate.
 */
enum RouteType {
  /** Browser-native UI page served from nova:// */
  InternalPage = 'internal-page',
  /** Standard web document fetched over HTTP/HTTPS */
  WebContent   = 'web-content',
  /** Local file served from the filesystem via file:// */
  LocalFile    = 'local-file',
  /** about:blank — an empty, sandboxed page */
  BlankPage    = 'blank-page',
  /** about:newtab — the configurable new-tab experience */
  NewTabPage   = 'new-tab-page',
  /** A dedicated error page (navigation failure, CSP block, etc.) */
  ErrorPage    = 'error-page',
  /** Secure file transfer (FTPS, SFTP) */
  SecureFileTransfer = 'secure-file-transfer',
  /** WebSocket connection (ws:, wss:) */
  WebSocket    = 'websocket',
  /** External protocol delegated to OS (mailto:, tel:, ssh:, magnet:, etc.) */
  ExternalProtocol = 'external-protocol',
  /** Inline data URI rendered in-browser (data:) */
  DataUri      = 'data-uri',
  /** Blob URL rendered in-browser (blob:) */
  BlobUrl      = 'blob-url',
  /** Legacy protocol (gopher:, wais:) */
  LegacyProtocol = 'legacy-protocol',
  /** Usenet protocol (news:, nntp:) */
  Usenet       = 'usenet',
  /** Gateway protocol (proxy, DNS, tunnel, NAT, access, LB, CDN, discovery) */
  Gateway      = 'gateway',
  /** URL matched no registered route */
  Unknown      = 'unknown',
}

/**
 * How the router interprets a route's `pattern` string.
 *
 * Exact    — full href or normalized URL must equal the pattern.
 * Prefix   — href must start with the pattern string.
 * Protocol — only the URL scheme (e.g. "https:") is compared.
 * RegExp   — pattern is compiled as a RegExp; named capture groups
 *            become route params.
 */
enum MatchStrategy {
  Exact    = 'exact',
  Prefix   = 'prefix',
  Protocol = 'protocol',
  RegExp   = 'regexp',
}

// ─────────────────────────────────────────────────────────────────────────────
// VALUE OBJECTS
// ─────────────────────────────────────────────────────────────────────────────

/** Everything the handler needs to produce a RouteResult. */
interface RouteContext {
  /** The committed navigation entry. */
  readonly entry: NavigationEntry;
  /** Fully-parsed URL components from url-parser.ts. */
  readonly parsedUrl: ParsedUrl;
  /**
   * Named parameters extracted from the URL.
   * Populated only when the route uses MatchStrategy.RegExp with named groups.
   */
  readonly params: ReadonlyMap<string, string>;
}

/** The outcome produced by a route handler, consumed by the rendering layer. */
interface RouteResult {
  /** Which rendering path to activate. */
  readonly type: RouteType;
  /**
   * Stable identifier for the page component to mount.
   * e.g. "settings", "downloads", "web-content", "blank"
   */
  readonly pageId: string;
  /** Document title to show in the browser chrome. */
  readonly title: string;
  /** Arbitrary data the handler wants to pass to the page component. */
  readonly data: Readonly<Record<string, unknown>>;
}

/** Returned by match() — describes whether a route was found and which one. */
interface RouteMatch {
  readonly matched: boolean;
  /** The winning route, if matched. */
  readonly route?: Readonly<Route>;
  /** Extracted URL params — empty Map when strategy ≠ RegExp. */
  readonly params: ReadonlyMap<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE DESCRIPTOR
// ─────────────────────────────────────────────────────────────────────────────

/** A function that receives a RouteContext and returns a RouteResult. */
type RouteHandler = (ctx: RouteContext) => Promise<RouteResult>;

/**
 * A fully-described route registration.
 * Immutable after construction — handlers cannot be swapped in place;
 * unregister and re-register instead.
 */
interface Route {
  /** Unique string identifier assigned by register(). */
  readonly id: string;
  /**
   * The pattern string interpreted according to `strategy`:
   *   Exact    — "about:blank"
   *   Prefix   — "nova://"
   *   Protocol — "https:"
   *   RegExp   — "^https://(?<host>[^/]+)/docs/(?<slug>.+)$"
   */
  readonly pattern: string;
  readonly strategy: MatchStrategy;
  readonly type: RouteType;
  /**
   * Tie-breaking when multiple routes match.
   * Higher number wins.  Built-in routes use 100 (internal), 50 (prefix),
   * 10 (protocol).  Custom routes default to 0.
   */
  readonly priority: number;
  readonly handler: RouteHandler;
  /** Optional human-readable label for debugging / DevTools. */
  readonly label?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

interface IRouter {
  /**
   * Find the highest-priority route that matches `entry`.
   * Never throws — returns `{ matched: false }` when no route is found.
   */
  match(entry: NavigationEntry): RouteMatch;

  /**
   * Match and invoke the handler for `entry`.
   * Returns a fallback ErrorPage result when no route is found.
   */
  dispatch(entry: NavigationEntry): Promise<RouteResult>;

  /**
   * Add a new route.
   * @returns The auto-generated route id (use it with unregister).
   * @throws  {DuplicateRouteError} if a route with the same pattern+strategy already exists.
   */
  register(options: Omit<Route, 'id'>): string;

  /**
   * Remove a previously registered route by its id.
   * @returns true if the route was found and removed, false otherwise.
   */
  unregister(id: string): boolean;

  /** True when a route with `id` is registered. */
  has(id: string): boolean;

  /**
   * Subscribe to a NavigationController so that every "navigationCommitted"
   * event automatically triggers dispatch().
   */
  connectController(controller: INavigationController): void;

  /** Unsubscribe from a previously connected controller. */
  disconnectController(controller: INavigationController): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// ERRORS
// ─────────────────────────────────────────────────────────────────────────────

class RouteNotFoundError extends Error {
  readonly url: string;
  constructor(url: string) {
    super(`No route matched URL: "${url}"`);
    this.name = 'RouteNotFoundError';
    this.url  = url;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class DuplicateRouteError extends Error {
  readonly pattern: string;
  readonly strategy: MatchStrategy;
  constructor(pattern: string, strategy: MatchStrategy) {
    super(`A route with pattern "${pattern}" and strategy "${strategy}" is already registered.`);
    this.name     = 'DuplicateRouteError';
    this.pattern  = pattern;
    this.strategy = strategy;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Concrete IRouter implementation.
 *
 * Matching pipeline
 * ──────────────────
 *  1. Collect all registered routes.
 *  2. Sort by priority descending (stable sort — insertion order wins ties).
 *  3. Test each route's pattern against the NavigationEntry's parsedUrl.
 *  4. Return the first match, or { matched: false }.
 *
 * Built-in routes are registered during construction and can be unregistered
 * by id if the application needs to override them.
 */
class Router implements IRouter {

  /** All registered routes, keyed by id. */
  private readonly routes = new Map<string, Route>();

  /**
   * Controllers this router is subscribed to.
   * Stored so we can remove the exact same handler reference on disconnect.
   */
  private readonly controllerListeners = new Map<
    INavigationController,
    (event: NavigationEvent) => void
  >();

  /** Monotonically increasing counter for generating unique route ids. */
  private idSeq = 0;

  /** Ids of the routes registered by registerBuiltinRoutes(). */
  private readonly builtinIds = new Set<string>();

  constructor() {
    this.registerBuiltinRoutes();
  }

  // ── IRouter: match ─────────────────────────────────────────────────────────

  match(entry: NavigationEntry): RouteMatch {
    const sorted = this.sortedRoutes();
    for (const route of sorted) {
      const params = this.testRoute(route, entry.parsedUrl);
      if (params !== null) {
        return { matched: true, route, params };
      }
    }
    return { matched: false, params: new Map() };
  }

  // ── IRouter: dispatch ──────────────────────────────────────────────────────

  async dispatch(entry: NavigationEntry): Promise<RouteResult> {
    const { matched, route, params } = this.match(entry);

    if (!matched || route === undefined) {
      return this.unknownResult(entry);
    }

    const ctx: RouteContext = {
      entry,
      parsedUrl: entry.parsedUrl,
      params,
    };

    try {
      return await route.handler(ctx);
    } catch (err) {
      console.error(`[Router] Handler for route "${route.id}" threw:`, err);
      return this.errorResult(entry, err instanceof Error ? err : new Error(String(err)));
    }
  }

  // ── IRouter: register / unregister ────────────────────────────────────────

  register(options: Omit<Route, 'id'>): string {
    // Guard against duplicate pattern+strategy pairs.
    for (const existing of this.routes.values()) {
      if (
        existing.pattern  === options.pattern &&
        existing.strategy === options.strategy
      ) {
        throw new DuplicateRouteError(options.pattern, options.strategy);
      }
    }

    const id    = `route-${(++this.idSeq).toString(36)}`;
    const route: Route = { ...options, id };
    this.routes.set(id, route);
    return id;
  }

  unregister(id: string): boolean {
    const existed = this.routes.delete(id);
    this.builtinIds.delete(id);
    return existed;
  }

  has(id: string): boolean {
    return this.routes.has(id);
  }

  // ── IRouter: controller integration ───────────────────────────────────────

  connectController(controller: INavigationController): void {
    if (this.controllerListeners.has(controller)) {
      return; // Already connected.
    }

    const listener = (event: NavigationEvent): void => {
      if (event.kind === 'navigationCommitted') {
        void this.dispatch(event.entry).catch(err => {
          console.error('[Router] dispatch() threw after navigationCommitted:', err);
        });
      }
    };

    this.controllerListeners.set(controller, listener);
    controller.on('navigationCommitted', listener);
  }

  disconnectController(controller: INavigationController): void {
    const listener = this.controllerListeners.get(controller);
    if (listener === undefined) return;

    controller.off('navigationCommitted', listener);
    this.controllerListeners.delete(controller);
  }

  // ── Private: pattern matching ──────────────────────────────────────────────

  /**
   * Returns all routes sorted by priority (descending).
   * Uses a stable sort so routes with equal priority preserve insertion order.
   */
  private sortedRoutes(): Route[] {
    return [...this.routes.values()].sort((a, b) => b.priority - a.priority);
  }

  /**
   * Test a single route against a ParsedUrl.
   * @returns A (possibly empty) params Map on match, or null on non-match.
   */
  private testRoute(
    route: Route,
    parsedUrl: ParsedUrl,
  ): ReadonlyMap<string, string> | null {
    const href       = parsedUrl.href;
    const normalized = parsedUrl.normalized;

    switch (route.strategy) {

      case MatchStrategy.Exact:
        if (href === route.pattern || normalized === route.pattern) {
          return new Map();
        }
        return null;

      case MatchStrategy.Prefix:
        if (href.startsWith(route.pattern) || normalized.startsWith(route.pattern)) {
          return new Map();
        }
        return null;

      case MatchStrategy.Protocol:
        // parsedUrl.protocol is already lowercase with trailing colon, e.g. "https:"
        if (parsedUrl.protocol === route.pattern) {
          return new Map();
        }
        return null;

      case MatchStrategy.RegExp: {
        let regex: RegExp;
        try {
          regex = new RegExp(route.pattern, 'u');
        } catch {
          console.warn(`[Router] Invalid RegExp pattern for route "${route.id}": ${route.pattern}`);
          return null;
        }
        const m = regex.exec(href) ?? regex.exec(normalized);
        if (m === null) return null;
        const params = new Map<string, string>();
        if (m.groups) {
          for (const [key, value] of Object.entries(m.groups)) {
            if (typeof value === 'string') params.set(key, value);
          }
        }
        return params;
      }

      default:
        return null;
    }
  }

  // ── Private: built-in route registration ──────────────────────────────────

  /**
   * Register all browser built-in routes.
   * Called once in the constructor.  Route ids are stored in builtinIds so
   * callers can inspect which routes are built-in.
   */
  private registerBuiltinRoutes(): void {

    const add = (options: Omit<Route, 'id'>): void => {
      const id = this.register(options);
      this.builtinIds.add(id);
    };

    // ── Special pages (exact match, highest priority) ────────────────────────
    add({
      pattern:  'about:blank',
      strategy: MatchStrategy.Exact,
      type:     RouteType.BlankPage,
      priority: 200,
      label:    'built-in:blank',
      handler:  Router.makeStaticHandler(RouteType.BlankPage, 'blank', 'New Tab'),
    });

    add({
      pattern:  'about:newtab',
      strategy: MatchStrategy.Exact,
      type:     RouteType.NewTabPage,
      priority: 200,
      label:    'built-in:newtab',
      handler:  Router.makeStaticHandler(RouteType.NewTabPage, 'newtab', 'New Tab'),
    });

    // ── Internal nova:// pages (exact match) ─────────────────────────────────
    const internalPages: Array<[string, string, string]> = [
      ['nova://newtab',     'newtab',     'New Tab'],
      ['nova://settings',   'settings',   'Settings'],
      ['nova://downloads',  'downloads',  'Downloads'],
      ['nova://history',    'history',    'History'],
      ['nova://bookmarks',  'bookmarks',  'Bookmarks'],
      ['nova://extensions', 'extensions', 'Extensions'],
      ['nova://research',   'research',   'AI Research'],
    ];

    for (const [pattern, pageId, title] of internalPages) {
      add({
        pattern,
        strategy: MatchStrategy.Exact,
        type:     RouteType.InternalPage,
        priority: 150,
        label:    `built-in:${pageId}`,
        handler:  Router.makeStaticHandler(RouteType.InternalPage, pageId, title),
      });
    }

    // ── Internal data/blob protocols (protocol match, high priority) ───────
    add({
      pattern:  'data:',
      strategy: MatchStrategy.Protocol,
      type:     RouteType.DataUri,
      priority: 50,
      label:    'built-in:data',
      handler:  Router.makeDataUriHandler(),
    });

    add({
      pattern:  'blob:',
      strategy: MatchStrategy.Protocol,
      type:     RouteType.BlobUrl,
      priority: 50,
      label:    'built-in:blob',
      handler:  Router.makeBlobUrlHandler(),
    });

    // ── External protocols (protocol match, delegated to OS) ──────────────
    const externalProtocols: Array<[string, string]> = [
      ['mailto:',  'built-in:mailto'],
      ['tel:',     'built-in:tel'],
      ['sms:',     'built-in:sms'],
      ['smsto:',   'built-in:smsto'],
      ['ssh:',     'built-in:ssh'],
      ['magnet:',  'built-in:magnet'],
    ];

    for (const [proto, label] of externalProtocols) {
      add({
        pattern:  proto,
        strategy: MatchStrategy.Protocol,
        type:     RouteType.ExternalProtocol,
        priority: 30,
        label,
        handler:  Router.makeExternalHandler(),
      });
    }

    // ── WebSocket protocols (protocol match) ──────────────────────────────
    const wsProtocols: Array<[string, string]> = [
      ['wss:', 'built-in:wss'],
      ['ws:',  'built-in:ws'],
    ];

    for (const [proto, label] of wsProtocols) {
      add({
        pattern:  proto,
        strategy: MatchStrategy.Protocol,
        type:     RouteType.WebSocket,
        priority: 20,
        label,
        handler:  Router.makeWebSocketHandler(),
      });
    }

    // ── Usenet protocols (protocol match) ─────────────────────────────────
    const usenetProtocols: Array<[string, string]> = [
      ['news:', 'built-in:news'],
      ['nntp:', 'built-in:nntp'],
    ];

    for (const [proto, label] of usenetProtocols) {
      add({
        pattern:  proto,
        strategy: MatchStrategy.Protocol,
        type:     RouteType.Usenet,
        priority: 15,
        label,
        handler:  Router.makeWebHandler(),
      });
    }

    // ── Legacy protocols (protocol match) ─────────────────────────────────
    const legacyProtocols: Array<[string, string]> = [
      ['gopher:', 'built-in:gopher'],
      ['wais:',   'built-in:wais'],
    ];

    for (const [proto, label] of legacyProtocols) {
      add({
        pattern:  proto,
        strategy: MatchStrategy.Protocol,
        type:     RouteType.LegacyProtocol,
        priority: 12,
        label,
        handler:  Router.makeLegacyHandler(),
      });
    }

    // ── Protocol-based fallbacks (lowest built-in priority) ─────────────────
    const webProtocols: Array<[string, string]> = [
      ['https:', 'built-in:https'],
      ['http:',  'built-in:http'],
      ['ftp:',   'built-in:ftp'],
    ];

    for (const [proto, label] of webProtocols) {
      add({
        pattern:  proto,
        strategy: MatchStrategy.Protocol,
        type:     RouteType.WebContent,
        priority: 10,
        label,
        handler:  Router.makeWebHandler(),
      });
    }

    // ── Secure file transfer protocols ─────────────────────────────────────
    const sftpProtocols: Array<[string, string]> = [
      ['ftps:', 'built-in:ftps'],
      ['sftp:', 'built-in:sftp'],
    ];

    for (const [proto, label] of sftpProtocols) {
      add({
        pattern:  proto,
        strategy: MatchStrategy.Protocol,
        type:     RouteType.SecureFileTransfer,
        priority: 10,
        label,
        handler:  Router.makeSftpHandler(),
      });
    }

    // ── Gateway protocols (protocol match, delegated to gateway manager) ───
    const gatewayManager = new GatewayProtocolManager();
    const gatewayCategories: Array<[GatewayCategory, string]> = [
      [GatewayCategory.Proxy,        'proxy'],
      [GatewayCategory.DNS,          'dns'],
      [GatewayCategory.Tunnel,       'tunnel'],
      [GatewayCategory.NAT,          'nat'],
      [GatewayCategory.Access,       'access'],
      [GatewayCategory.LoadBalancer, 'load-balancer'],
      [GatewayCategory.CDN,          'cdn'],
      [GatewayCategory.Discovery,    'discovery'],
    ];

    for (const [category, categoryLabel] of gatewayCategories) {
      const schemes = gatewayManager.getSchemesByCategory(category);
      for (const scheme of schemes) {
        const result = gatewayManager.resolveScheme(scheme);
        if (result) {
          add({
            pattern:  scheme,
            strategy: MatchStrategy.Protocol,
            type:     RouteType.Gateway,
            priority: 5,
            label:    `built-in:gateway:${categoryLabel}:${result.label}`,
            handler:  Router.makeGatewayHandler(categoryLabel, result.label),
          });
        }
      }
    }

    add({
      pattern:  'file:',
      strategy: MatchStrategy.Protocol,
      type:     RouteType.LocalFile,
      priority: 10,
      label:    'built-in:file',
      handler:  Router.makeFileHandler(),
    });
  }

  // ── Private: stock handler factories ──────────────────────────────────────

  /**
   * Returns a handler that resolves immediately with fixed type / pageId / title.
   * Used for all nova:// pages and blank/newtab pages.
   */
  private static makeStaticHandler(
    type: RouteType,
    pageId: string,
    title: string,
  ): RouteHandler {
    return async (ctx: RouteContext): Promise<RouteResult> => ({
      type,
      pageId,
      title,
      data: { url: ctx.parsedUrl.href },
    });
  }

  /** Handler for http/https/ftp — provides enough context for the renderer. */
  private static makeWebHandler(): RouteHandler {
    return async (ctx: RouteContext): Promise<RouteResult> => ({
      type:   RouteType.WebContent,
      pageId: 'web-content',
      title:  ctx.parsedUrl.hostname || ctx.parsedUrl.href,
      data: {
        url:       ctx.parsedUrl.href,
        isSecure:  ctx.parsedUrl.isSecure,
        hostname:  ctx.parsedUrl.hostname,
        protocol:  ctx.parsedUrl.protocol,
      },
    });
  }

  /** Handler for file:// URLs. */
  private static makeFileHandler(): RouteHandler {
    return async (ctx: RouteContext): Promise<RouteResult> => ({
      type:   RouteType.LocalFile,
      pageId: 'local-file',
      title:  ctx.parsedUrl.pathname || ctx.parsedUrl.href,
      data: {
        url:      ctx.parsedUrl.href,
        pathname: ctx.parsedUrl.pathname,
      },
    });
  }

  /** Handler for secure file transfer (FTPS, SFTP). */
  private static makeSftpHandler(): RouteHandler {
    return async (ctx: RouteContext): Promise<RouteResult> => ({
      type:   RouteType.SecureFileTransfer,
      pageId: 'secure-file-transfer',
      title:  ctx.parsedUrl.hostname || ctx.parsedUrl.href,
      data: {
        url:      ctx.parsedUrl.href,
        hostname: ctx.parsedUrl.hostname,
        protocol: ctx.parsedUrl.protocol,
        isSecure: ctx.parsedUrl.isSecure,
      },
    });
  }

  /** Handler for WebSocket (ws:, wss:). */
  private static makeWebSocketHandler(): RouteHandler {
    return async (ctx: RouteContext): Promise<RouteResult> => ({
      type:   RouteType.WebSocket,
      pageId: 'websocket',
      title:  ctx.parsedUrl.hostname || ctx.parsedUrl.href,
      data: {
        url:      ctx.parsedUrl.href,
        hostname: ctx.parsedUrl.hostname,
        protocol: ctx.parsedUrl.protocol,
        isSecure: ctx.parsedUrl.isSecure,
      },
    });
  }

  /** Handler for external protocols (mailto:, tel:, ssh:, magnet:, etc.). */
  private static makeExternalHandler(): RouteHandler {
    return async (ctx: RouteContext): Promise<RouteResult> => ({
      type:   RouteType.ExternalProtocol,
      pageId: 'external-protocol',
      title:  ctx.parsedUrl.protocol.replace(':', '').toUpperCase(),
      data: {
        url:      ctx.parsedUrl.href,
        protocol: ctx.parsedUrl.protocol,
        action:   'delegate-to-os',
      },
    });
  }

  /** Handler for data: URIs. */
  private static makeDataUriHandler(): RouteHandler {
    return async (ctx: RouteContext): Promise<RouteResult> => ({
      type:   RouteType.DataUri,
      pageId: 'data-uri',
      title:  'Data URI',
      data: {
        url:      ctx.parsedUrl.href,
        protocol: ctx.parsedUrl.protocol,
      },
    });
  }

  /** Handler for blob: URLs. */
  private static makeBlobUrlHandler(): RouteHandler {
    return async (ctx: RouteContext): Promise<RouteResult> => ({
      type:   RouteType.BlobUrl,
      pageId: 'blob-url',
      title:  'Blob',
      data: {
        url:      ctx.parsedUrl.href,
        protocol: ctx.parsedUrl.protocol,
      },
    });
  }

  /** Handler for legacy protocols (gopher:, wais:). */
  private static makeLegacyHandler(): RouteHandler {
    return async (ctx: RouteContext): Promise<RouteResult> => ({
      type:   RouteType.LegacyProtocol,
      pageId: 'legacy-protocol',
      title:  ctx.parsedUrl.protocol.replace(':', '').toUpperCase(),
      data: {
        url:      ctx.parsedUrl.href,
        hostname: ctx.parsedUrl.hostname,
        protocol: ctx.parsedUrl.protocol,
      },
    });
  }

  /** Handler for gateway protocols (proxy, DNS, tunnel, NAT, etc.). */
  private static makeGatewayHandler(
    category: string,
    protocolLabel: string,
  ): RouteHandler {
    return async (ctx: RouteContext): Promise<RouteResult> => ({
      type:   RouteType.Gateway,
      pageId: `gateway-${category}`,
      title:  `${protocolLabel} (${ctx.parsedUrl.protocol.replace(':', '').toUpperCase()})`,
      data: {
        url:      ctx.parsedUrl.href,
        hostname: ctx.parsedUrl.hostname,
        protocol: ctx.parsedUrl.protocol,
        category,
        protocolLabel,
      },
    });
  }

  /** Fallback result when no route matched. */
  private unknownResult(entry: NavigationEntry): RouteResult {
    return {
      type:   RouteType.Unknown,
      pageId: 'error-no-route',
      title:  'Page not found',
      data:   { url: entry.url },
    };
  }

  /** Result for a handler that threw. */
  private errorResult(entry: NavigationEntry, error: Error): RouteResult {
    return {
      type:   RouteType.ErrorPage,
      pageId: 'error-handler',
      title:  'Error',
      data:   { url: entry.url, errorMessage: error.message },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  Router,
  RouteType,
  MatchStrategy,
  RouteNotFoundError,
  DuplicateRouteError,
};

export type {
  IRouter,
  Route,
  RouteContext,
  RouteResult,
  RouteMatch,
  RouteHandler,
};