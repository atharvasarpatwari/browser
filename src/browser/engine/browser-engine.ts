/**
 * @file src/browser/engine/browser-engine.ts
 * @session 5
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * BrowserEngine is the central coordinator for a single browser tab.
 * It owns the full page-load lifecycle and connects every subsystem:
 *
 *   NavigationController ──navigationCommitted──▶ BrowserEngine
 *        │                                              │
 *        │                              ┌───────────────▼──────────────┐
 *        │                              │  1. router.dispatch(entry)   │
 *        │                              │  2. IPageLoader.load(url)    │
 *        │                              │  3. IPageRenderer.render()   │
 *        │                              │  4. emit pageLoadComplete    │
 *        │                              └──────────────────────────────┘
 *        │
 *        └── back / forward / stop / reload (pass-through to controller)
 *
 * Subsystems not yet built (networking / rendering) are represented by
 * pluggable interfaces.  The engine stubs them automatically; real
 * implementations are injected via setPageLoader() / setPageRenderer()
 * as those sessions are completed.
 *
 * BrowserEngine also implements ISharedService so it can be registered
 * with AppShell and participate in the application lifecycle.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 *  Abstraction      IBrowserEngine hides all wiring from callers.
 *                   IPageLoader and IPageRenderer are pure interfaces —
 *                   the engine never imports concrete networking/rendering classes.
 *  Encapsulation    PageLoadSession is created and mutated only inside the engine.
 *                   External code observes progress through events or getCurrentSession().
 *  Single-Resp.     Engine orchestrates; it never fetches or renders itself.
 *  Open / Closed    New pipeline steps (e.g. CSP check, pre-render hooks) are
 *                   added via middleware without modifying the engine class.
 *  Dependency-Inv.  Constructor receives INavigationController, IRouter, AppConfig —
 *                   never concrete implementations.
 *  Interface-Seg.   IPageLoader and IPageRenderer are minimal; implementations
 *                   are not forced to carry unused methods.
 */

import type { ISharedService, AppConfig } from '../../app/app-shell';
import type {
  INavigationController,
  NavigationEntry,
  NavigationEvent,
  NavigationCommittedEvent,
} from '../navigation/navigation-controller';
import type { IRouter, RouteResult } from '../navigation/router';
import { RouteType }                  from '../navigation/router';
import type { ILayoutEngine }         from '../rendering/layout-engine';

// ─────────────────────────────────────────────────────────────────────────────
// PAGE LOAD STATE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lifecycle states for a single page load.
 *
 *   Idle ──navigate──▶ Routing ──▶ Fetching ──▶ Parsing ──▶ Ready
 *                                                          ↘ Error
 *                      (Routing and Fetching are skipped   ↘ Aborted
 *                       for internal/blank pages)
 */
enum PageLoadState {
  /** No load in progress. */
  Idle     = 'idle',
  /** Router is matching the entry to a handler. */
  Routing  = 'routing',
  /** Network fetch is underway (WebContent / LocalFile only). */
  Fetching = 'fetching',
  /** Content received; parser is building the DOM. */
  Parsing  = 'parsing',
  /** Page is interactive. */
  Ready    = 'ready',
  /** An unrecoverable error occurred. */
  Error    = 'error',
  /** User or code called stop() before the load completed. */
  Aborted  = 'aborted',
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE LOAD SESSION
// ─────────────────────────────────────────────────────────────────────────────

/** Tracks every detail of a single page load from commit to ready. */
interface PageLoadSession {
  /** Unique identifier for this load attempt. */
  readonly id: string;
  /** The navigation entry that triggered this load. */
  readonly entry: NavigationEntry;
  /** The route the engine resolved for this entry. */
  routeResult: RouteResult | null;
  /**
   * Final URL after server-side redirects (differs from entry.url when a 3xx
   * was followed). Set once the document has been fetched.
   */
  finalUrl?: string;
  /** Current lifecycle state. */
  state: PageLoadState;
  /** Wall clock time when the load started (navigationCommitted). */
  readonly startedAt: number;
  /** Wall clock time when state reached Ready or Error. */
  completedAt?: number;
  /** Error that caused the load to fail, if any. */
  error?: Error;
  /** AbortController so the load can be cancelled by stop(). */
  readonly abortController: AbortController;
}

// ─────────────────────────────────────────────────────────────────────────────
// PLUGGABLE SUBSYSTEM INTERFACES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches the raw document for a URL.
 * Implemented by networking/request-manager.ts (Session 7).
 */
interface IPageLoader {
  load(url: string, signal: AbortSignal): Promise<PageLoadResult>;
}

/**
 * Parses and renders a fetched document into the visible view.
 * Implemented by the rendering pipeline (Sessions 11–15).
 */
interface IPageRenderer {
  render(result: PageLoadResult, signal: AbortSignal): Promise<void>;
  /** The layout engine backing the most recently rendered page (null before any page / for the null renderer). */
  getLayoutEngine(): ILayoutEngine | null;
}

/** Raw document received from the network. */
interface PageLoadResult {
  readonly url: string;
  readonly statusCode: number;
  readonly contentType: string;
  readonly body: string;
  readonly headers: ReadonlyMap<string, string>;
  readonly loadedAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// ENGINE EVENTS
// ─────────────────────────────────────────────────────────────────────────────

type EngineEventType =
  | 'pageLoadStarted'
  | 'pageLoadRouted'
  | 'pageLoadFetched'
  | 'pageLoadReady'
  | 'pageRepainted'
  | 'pageLoadError'
  | 'pageLoadAborted';

interface PageLoadStartedEvent  { kind: 'pageLoadStarted';  session: PageLoadSession }
interface PageLoadRoutedEvent   { kind: 'pageLoadRouted';   session: PageLoadSession; result: RouteResult }
interface PageLoadFetchedEvent  { kind: 'pageLoadFetched';  session: PageLoadSession; raw: PageLoadResult }
interface PageLoadReadyEvent    { kind: 'pageLoadReady';    session: PageLoadSession; elapsedMs: number }
interface PageRepaintedEvent    { kind: 'pageRepainted';    session: PageLoadSession | null }
interface PageLoadErrorEvent    { kind: 'pageLoadError';    session: PageLoadSession; error: Error }
interface PageLoadAbortedEvent  { kind: 'pageLoadAborted';  session: PageLoadSession }

type EngineEvent =
  | PageLoadStartedEvent
  | PageLoadRoutedEvent
  | PageLoadFetchedEvent
  | PageLoadReadyEvent
  | PageRepaintedEvent
  | PageLoadErrorEvent
  | PageLoadAbortedEvent;

// ─────────────────────────────────────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An async middleware function that runs between routing and fetching.
 * Return false to abort the load (e.g. CSP check, safe-browsing filter).
 * Throw to abort with an error.
 */
type EngineMiddleware = (session: PageLoadSession) => Promise<boolean>;

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

interface IBrowserEngine extends ISharedService {
  /** The navigation controller wired to this engine. */
  readonly navigationController: INavigationController;
  /** The router wired to this engine. */
  readonly router: IRouter;

  // ── Navigation pass-throughs ──────────────────────────────────────────────
  navigate(url: string, referrer?: string): Promise<void>;
  back(): void;
  forward(): void;
  stop(): void;
  reload(): void;

  // ── Page load state ───────────────────────────────────────────────────────
  getCurrentSession(): PageLoadSession | null;

  // ── Plugin points ─────────────────────────────────────────────────────────
  /** Plug in a real IPageLoader when the networking layer is ready. */
  setPageLoader(loader: IPageLoader): void;
  /** Plug in a real IPageRenderer when the rendering layer is ready. */
  setPageRenderer(renderer: IPageRenderer): void;
  /** The layout engine of the currently rendered page (null before any page renders). */
  getPageLayoutEngine(): ILayoutEngine | null;
  /** Add a middleware that runs after routing, before fetching. */
  addMiddleware(mw: EngineMiddleware): void;

  // ── Events ────────────────────────────────────────────────────────────────
  on(type: EngineEventType, handler: (event: EngineEvent) => void): void;
  off(type: EngineEventType, handler: (event: EngineEvent) => void): void;
  /** Notify listeners that the page was repainted (e.g. after async loads). */
  notifyPageRepainted(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// ERRORS
// ─────────────────────────────────────────────────────────────────────────────

class PageLoadError extends Error {
  readonly sessionId: string;
  constructor(sessionId: string, message: string) {
    super(message);
    this.name      = 'PageLoadError';
    this.sessionId = sessionId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class EngineNotInitializedError extends Error {
  constructor() {
    super('BrowserEngine has not been initialized. Call initialize() first.');
    this.name = 'EngineNotInitializedError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STUB IMPLEMENTATIONS  (replaced when subsystems are wired in)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * No-op loader used until the networking layer is ready.
 * Returns an empty 200 response so internal pages load without errors.
 */
class NullPageLoader implements IPageLoader {
  async load(url: string, _signal: AbortSignal): Promise<PageLoadResult> {
    return {
      url,
      statusCode:  200,
      contentType: 'text/html',
      body:        '',
      headers:     new Map(),
      loadedAt:    Date.now(),
    };
  }
}

/**
 * No-op renderer used until the rendering pipeline is ready.
 * Logs a placeholder so developers can see when rendering is invoked.
 */
class NullPageRenderer implements IPageRenderer {
  async render(result: PageLoadResult, _signal: AbortSignal): Promise<void> {
    console.log(`[NullPageRenderer] Would render ${result.url} (${result.contentType})`);
  }
  getLayoutEngine(): ILayoutEngine | null {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPED EVENT BUS  (scoped to engine events)
// ─────────────────────────────────────────────────────────────────────────────

class EngineEventBus {
  private readonly channels = new Map<
    EngineEventType,
    Set<(e: EngineEvent) => void>
  >();

  on(type: EngineEventType, handler: (e: EngineEvent) => void): void {
    if (!this.channels.has(type)) this.channels.set(type, new Set());
    this.channels.get(type)!.add(handler);
  }

  off(type: EngineEventType, handler: (e: EngineEvent) => void): void {
    this.channels.get(type)?.delete(handler);
  }

  emit(event: EngineEvent): void {
    const handlers = this.channels.get(event.kind as EngineEventType);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); }
      catch (err) {
        console.error(`[EngineEventBus] Handler threw on "${event.kind}":`, err);
      }
    }
  }

  dispose(): void { this.channels.clear(); }
}

// ─────────────────────────────────────────────────────────────────────────────
// BROWSER ENGINE
// ─────────────────────────────────────────────────────────────────────────────

class BrowserEngine implements IBrowserEngine, ISharedService {

  readonly name = 'BrowserEngine';

  private readonly navController: INavigationController;
  private readonly _router:       IRouter;
  private readonly config:        AppConfig;
  private readonly bus:           EngineEventBus;
  private readonly middlewares:   EngineMiddleware[] = [];

  private loader:   IPageLoader   = new NullPageLoader();
  private renderer: IPageRenderer = new NullPageRenderer();

  private _session:         PageLoadSession | null = null;
  private sessionSeq        = 0;
  private _initialized      = false;

  /** Bound reference kept so we can unsubscribe in shutdown(). */
  private readonly navCommittedHandler: (e: NavigationEvent) => void;

  constructor(
    navController: INavigationController,
    router: IRouter,
    config: AppConfig,
  ) {
    this.navController = navController;
    this._router       = router;
    this.config        = config;
    this.bus           = new EngineEventBus();

    // Defer navigation completion until the page pipeline finishes rendering,
    // so navigationCompleted reflects the real end of a load.
    navController.setDeferredCompletion(true);

    // Create a stable bound reference for clean unsubscribe later.
    this.navCommittedHandler = (event: NavigationEvent) => {
      if (event.kind === 'navigationCommitted') {
        void this.handleNavigationCommitted(event);
      }
    };
  }

  // ── ISharedService ─────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this._initialized) return;
    this.navController.on('navigationCommitted', this.navCommittedHandler);
    this._initialized = true;
    this.log('Initialized');
  }

  async shutdown(): Promise<void> {
    if (!this._initialized) return;

    // Abort any in-progress load.
    if (this._session?.abortController.signal.aborted === false) {
      this._session.abortController.abort();
    }

    this.navController.off('navigationCommitted', this.navCommittedHandler);
    this._router.disconnectController(this.navController);
    this.bus.dispose();
    this._initialized = false;
    this.log('Shut down');
  }

  // ── IBrowserEngine: navigation pass-throughs ───────────────────────────────

  async navigate(url: string, referrer?: string): Promise<void> {
    this.assertInitialized();
    await this.navController.navigate(url, referrer);
  }

  back(): void {
    this.assertInitialized();
    this.navController.back();
  }

  forward(): void {
    this.assertInitialized();
    this.navController.forward();
  }

  stop(): void {
    this.assertInitialized();
    this._session?.abortController.abort();
    this.navController.stop();
  }

  reload(): void {
    this.assertInitialized();
    this.navController.reload();
  }

  // ── IBrowserEngine: state ──────────────────────────────────────────────────

  get navigationController(): INavigationController { return this.navController; }
  get router():               IRouter               { return this._router; }

  getCurrentSession(): PageLoadSession | null {
    return this._session;
  }

  // ── IBrowserEngine: plugin points ──────────────────────────────────────────

  setPageLoader(loader: IPageLoader): void {
    this.loader = loader;
    this.log('PageLoader plugged in');
  }

  setPageRenderer(renderer: IPageRenderer): void {
    this.renderer = renderer;
    this.log('PageRenderer plugged in');
  }

  getPageLayoutEngine(): ILayoutEngine | null {
    return this.renderer.getLayoutEngine();
  }

  addMiddleware(mw: EngineMiddleware): void {
    this.middlewares.push(mw);
  }

  // ── IBrowserEngine: events ─────────────────────────────────────────────────

  on(type: EngineEventType, handler: (event: EngineEvent) => void): void {
    this.bus.on(type, handler);
  }

  off(type: EngineEventType, handler: (event: EngineEvent) => void): void {
    this.bus.off(type, handler);
  }

  /**
   * Emit a repaint notification to listeners (e.g. after async image loads
   * finish decoding and a reflow frame re-rasterized the page).
   */
  notifyPageRepainted(): void {
    this.bus.emit({ kind: 'pageRepainted', session: this._session });
  }

  // ── Private: page load pipeline ───────────────────────────────────────────

  private async handleNavigationCommitted(
    event: NavigationCommittedEvent,
  ): Promise<void> {
    const { entry } = event;

    // Abort any previously running load.
    this._session?.abortController.abort();

    const session: PageLoadSession = {
      id:              `pls-${(++this.sessionSeq).toString(36)}`,
      entry,
      routeResult:     null,
      state:           PageLoadState.Routing,
      startedAt:       Date.now(),
      abortController: new AbortController(),
    };

    this._session = session;
    this.bus.emit({ kind: 'pageLoadStarted', session });

    try {
      await this.runPipeline(session);
      // The document finished loading — complete the committed navigation so
      // the controller's state machine matches the real page lifecycle.
      this.navController.completeNavigation(session.entry.id);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (session.abortController.signal.aborted) {
        session.state       = PageLoadState.Aborted;
        session.completedAt = Date.now();
        this.bus.emit({ kind: 'pageLoadAborted', session });
      } else {
        session.state       = PageLoadState.Error;
        session.error       = error;
        session.completedAt = Date.now();
        this.bus.emit({ kind: 'pageLoadError', session, error });
      }
    }
  }

  /**
   * The sequential pipeline for one page load.
   * Each step checks the abort signal before proceeding.
   */
  private async runPipeline(session: PageLoadSession): Promise<void> {
    const signal = session.abortController.signal;

    // ── Step 1: Route ──────────────────────────────────────────────────────
    this.throwIfAborted(signal, session);
    const routeResult = await this._router.dispatch(session.entry);
    session.routeResult = routeResult;
    session.state = PageLoadState.Fetching;
    this.bus.emit({ kind: 'pageLoadRouted', session, result: routeResult });

    // ── Step 2: Middleware chain ───────────────────────────────────────────
    this.throwIfAborted(signal, session);
    for (const mw of this.middlewares) {
      const proceed = await mw(session);
      if (!proceed) {
        throw new PageLoadError(session.id, 'Load aborted by middleware.');
      }
      this.throwIfAborted(signal, session);
    }

    // ── Step 3: Fetch (web content, local files, and network protocols only) ──
    let raw: PageLoadResult | null = null;
    if (
      routeResult.type === RouteType.WebContent ||
      routeResult.type === RouteType.LocalFile   ||
      routeResult.type === RouteType.WebSocket   ||
      routeResult.type === RouteType.SecureFileTransfer ||
      routeResult.type === RouteType.Usenet      ||
      routeResult.type === RouteType.LegacyProtocol ||
      routeResult.type === RouteType.Gateway
    ) {
      this.throwIfAborted(signal, session);
      raw = await this.loader.load(session.entry.url, signal);
      this.bus.emit({ kind: 'pageLoadFetched', session, raw });

      // A 3xx redirect changed the committed URL — surface the final URL so
      // the address bar / history follow the redirect without a new fetch.
      if (raw.url !== session.entry.url) {
        session.finalUrl = raw.url;
        this.navController.commitRedirectedUrl(raw.url);
      }
    }

    // ── Step 4: Render ────────────────────────────────────────────────────
    if (raw !== null) {
      this.throwIfAborted(signal, session);
      session.state = PageLoadState.Parsing;
      await this.renderer.render(raw, signal);
    }

    // ── Step 5: Complete ──────────────────────────────────────────────────
    this.throwIfAborted(signal, session);
    session.state       = PageLoadState.Ready;
    session.completedAt = Date.now();
    const elapsedMs     = session.completedAt - session.startedAt;
    this.bus.emit({ kind: 'pageLoadReady', session, elapsedMs });
    this.log(`Page ready: ${session.entry.url} (${elapsedMs}ms)`);
  }

  // ── Private: helpers ───────────────────────────────────────────────────────

  private throwIfAborted(signal: AbortSignal, session: PageLoadSession): void {
    if (signal.aborted) {
      throw new PageLoadError(session.id, 'Load was aborted.');
    }
  }

  private assertInitialized(): void {
    if (!this._initialized) throw new EngineNotInitializedError();
  }

  private log(msg: string): void {
    if (this.config.debug) {
      console.log(`[BrowserEngine:${this.sessionSeq}] ${msg}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  BrowserEngine,
  NullPageLoader,
  NullPageRenderer,
  EngineEventBus,
  PageLoadState,
  PageLoadError,
  EngineNotInitializedError,
};

export type {
  IBrowserEngine,
  IPageLoader,
  IPageRenderer,
  PageLoadSession,
  PageLoadResult,
  EngineEvent,
  EngineEventType,
  EngineMiddleware,
  PageLoadStartedEvent,
  PageLoadRoutedEvent,
  PageLoadFetchedEvent,
  PageLoadReadyEvent,
  PageLoadErrorEvent,
  PageLoadAbortedEvent,
};