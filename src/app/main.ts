import {
  DependencyContainer,
  ServiceLifetime,
} from './dependency-container';
import {
  AppShell,
  DEFAULT_CONFIG,
} from './app-shell';
import type { IServiceContainer } from './dependency-container';
import type { IAppShell, AppConfig, ISharedService } from './app-shell';

// Core navigation / engine
import { UrlParser } from '../browser/navigation/url-parser';
import type { IUrlParser } from '../browser/navigation/url-parser';
import { NavigationController } from '../browser/navigation/navigation-controller';
import type { INavigationController } from '../browser/navigation/navigation-controller';
import { Router } from '../browser/navigation/router';
import type { IRouter } from '../browser/navigation/router';
import { BrowserEngine } from '../browser/engine/browser-engine';
import type { IBrowserEngine, IPageLoader, IPageRenderer, PageLoadResult } from '../browser/engine/browser-engine';

// Tab management
import { TabManager } from '../browser/tabs/tab-manager';
import type { ITabManager } from '../browser/tabs/tab-manager';

// Services
import { HistoryService } from '../browser/history/history-service';
import type { IHistoryService } from '../browser/history/history-service';
import { BookmarkService } from '../browser/bookmarks/bookmark-services';
import type { IBookmarkService } from '../browser/bookmarks/bookmark-services';
import { DownloadManager } from '../browser/downloads/download-manager';
import type { IDownloadManager } from '../browser/downloads/download-manager';

// Networking
import { ResourceLoader } from '../browser/netwroking/resource-loader';
import type { IResourceLoader } from '../browser/netwroking/resource-loader';
import { CacheManager } from '../browser/netwroking/cache-manager';
import type { ICacheManager } from '../browser/netwroking/cache-manager';

// Security
import { CertificateValidator } from '../browser/security/certificate-validator';
import type { ICertificateValidator } from '../browser/security/certificate-validator';
import { SandboxManager } from '../browser/security/sandbox-manager';
import type { ISandboxManager } from '../browser/security/sandbox-manager';
import { PermissionManager } from '../browser/security/permission-manager';
import type { IPermissionManager } from '../browser/security/permission-manager';
import { TrackerBlocker } from '../browser/security/tracker-blocker';
import type { ITrackerBlocker } from '../browser/security/tracker-blocker';

// JavaScript runtime
import { JsRuntimeBridge } from '../browser/javascript/js-runtime-bridge';
import type { IJsRuntimeBridge } from '../browser/javascript/js-runtime-bridge';
import { EventLoop } from '../browser/javascript/event-loop';
import type { IEventLoop } from '../browser/javascript/event-loop';
import { DomBindings } from '../browser/javascript/dom-bindings';
import type { IDomBindings } from '../browser/javascript/dom-bindings';

// Rendering
import { DomTree } from '../browser/rendering/dom-tree';
import type { IDomTree } from '../browser/rendering/dom-tree';
import { CssParser } from '../browser/rendering/css-parser';
import type { ICssParser, CssRule } from '../browser/rendering/css-parser';
import { LayoutEngine } from '../browser/rendering/layout-engine';
import type { ILayoutEngine } from '../browser/rendering/layout-engine';
import { PaintEngine } from '../browser/rendering/paint-engine';
import type { IPaintEngine } from '../browser/rendering/paint-engine';
import { HtmlParser } from '../browser/rendering/html-parser';
import type { IHtmlParser } from '../browser/rendering/html-parser';

// Storage
import { InMemorySessionsStore } from '../browser/storage/sessions-store';
import type { ISessionsStore } from '../browser/storage/sessions-store';
import { InMemoryCookieStore } from '../browser/storage/cookie-store';
import type { ICookieStore } from '../browser/storage/cookie-store';

// Platform
import { RuntimeAdapter } from '../platform/shared/runtime-adapter';
import type { IRuntimeAdapter } from '../platform/shared/runtime-adapter';
import { WindowManager } from '../platform/desktop/window-manager';
import type { IWindowManager } from '../platform/desktop/window-manager';
import { MenuIntegration } from '../platform/desktop/menu-integration';
import type { IMenuIntegration } from '../platform/desktop/menu-integration';

// UI
import { AddressBar } from '../ui/components/address-bar/address-bar';
import type { IAddressBar } from '../ui/components/address-bar/address-bar';
import { DesktopLayout } from '../ui/layout/desktop-layout';
import type { IDesktopLayout } from '../ui/layout/desktop-layout';
import { BrowserWindowPage } from '../ui/pages/browser-window';
import type { IBrowserWindowPage } from '../ui/pages/browser-window';

// ── Service tokens ─────────────────────────────────────────────────────────────

/**
 * Well-known DI tokens.  Using const symbols prevents accidental token collision
 * if two modules happen to use the same string key.
 */
const Tokens = Object.freeze({
  AppConfig: Symbol('AppConfig'),
  AppShell: Symbol('AppShell'),
  UrlParser: Symbol('UrlParser'),
  NavigationController: Symbol('NavigationController'),
  Router: Symbol('Router'),
  BrowserEngine: Symbol('BrowserEngine'),
  TabManager: Symbol('TabManager'),
  HistoryService: Symbol('HistoryService'),
  BookmarkService: Symbol('BookmarkService'),
  DownloadManager: Symbol('DownloadManager'),
  ResourceLoader: Symbol('ResourceLoader'),
  CacheManager: Symbol('CacheManager'),
  CertificateValidator: Symbol('CertificateValidator'),
  SandboxManager: Symbol('SandboxManager'),
  PermissionManager: Symbol('PermissionManager'),
  TrackerBlocker: Symbol('TrackerBlocker'),
  JsRuntimeBridge: Symbol('JsRuntimeBridge'),
  EventLoop: Symbol('EventLoop'),
  DomBindings: Symbol('DomBindings'),
  DomTree: Symbol('DomTree'),
  CssParser: Symbol('CssParser'),
  LayoutEngine: Symbol('LayoutEngine'),
  PaintEngine: Symbol('PaintEngine'),
  SessionsStore: Symbol('SessionsStore'),
  CookieStore: Symbol('CookieStore'),
  RuntimeAdapter: Symbol('RuntimeAdapter'),
  WindowManager: Symbol('WindowManager'),
  MenuIntegration: Symbol('MenuIntegration'),
  AddressBar: Symbol('AddressBar'),
  DesktopLayout: Symbol('DesktopLayout'),
  BrowserWindowPage: Symbol('BrowserWindowPage'),
} as const);

// ── ConfigLoader ──────────────────────────────────────────────────────────────

/**
 * Reads configuration from the process environment.
 * Isolated into its own class so the loading strategy can be swapped
 * (e.g. JSON file, remote config) without touching bootstrap logic.
 */
class ConfigLoader {
  private readonly env: Record<string, string | undefined>;

  constructor(env: Record<string, string | undefined> = {}) {
    this.env = env;
  }

  load(): AppConfig {
    return {
      version: this.string('APP_VERSION', DEFAULT_CONFIG.version),
      debug: this.boolean('DEBUG', DEFAULT_CONFIG.debug),
      maxTabs: this.integer('MAX_TABS', DEFAULT_CONFIG.maxTabs),
      homePage: this.string('HOME_PAGE', DEFAULT_CONFIG.homePage),
      userAgent: this.string('USER_AGENT', DEFAULT_CONFIG.userAgent),
    };
  }

  private string(key: string, fallback: string): string {
    const val = this.env[key];
    return typeof val === 'string' && val.length > 0 ? val : fallback;
  }

  private boolean(key: string, fallback: boolean): boolean {
    const val = this.env[key];
    if (val === 'true')  return true;
    if (val === 'false') return false;
    return fallback;
  }

  private integer(key: string, fallback: number): number {
    const val = this.env[key];
    if (!val) return fallback;
    const parsed = parseInt(val, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}

// ── ApplicationBootstrap ──────────────────────────────────────────────────────

/**
 * Top-level orchestrator that wires together config, container, and shell.
 *
 * Usage
 * ─────
 *   const app = new ApplicationBootstrap();
 *   await app.start();
 *   // …later…
 *   await app.stop();
 */
class ApplicationBootstrap {
  private readonly config: AppConfig;
  private readonly container: IServiceContainer;
  private shell: IAppShell | null = null;
  private running = false;

  constructor(env: Record<string, string | undefined> = getProcessEnv()) {
    this.config = new ConfigLoader(env).load();
    this.container = new DependencyContainer();
  }

  // ── Start / stop ──────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) {
      console.warn('[Bootstrap] start() called on an already-running application — ignoring.');
      return;
    }

    this.log('Starting…');

    this.registerServices();

    this.shell = this.container.resolve<IAppShell>(Tokens.AppShell);

    this.registerSharedServices();

    await this.shell.mount();

    await this.mountBrowserUI();

    this.running = true;
    this.log(`Started (version ${this.config.version})`);
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.log('Stopping…');

    if (this.shell) {
      await this.shell.unmount();
      this.shell = null;
    }

    this.container.dispose();
    this.running = false;
    this.log('Stopped');
  }

  // ── Service wiring ────────────────────────────────────────────────────────

  /**
   * Registers all core services with the DI container.
   *
   * Services are grouped by subsystem:
   *   • Configuration, Shell
   *   • Navigation & Engine
   *   • Tab management
   *   • Application services (History, Bookmarks, Downloads)
   *   • Networking & Cache
   *   • Security
   *   • JavaScript runtime
   *   • Rendering pipeline
   *   • Storage
   *   • Platform adapters
   *   • UI components
   */
  private registerServices(): void {
    const c = this.container;

    // 1. Configuration & Shell
    c.registerValue<AppConfig>(Tokens.AppConfig, this.config);

    c.register<IAppShell>(
      Tokens.AppShell,
      (ctx) => new AppShell(ctx, ctx.resolve<AppConfig>(Tokens.AppConfig)),
      ServiceLifetime.Singleton,
    );

    // 2. Navigation & Engine
    c.register<IUrlParser>(Tokens.UrlParser, () => new UrlParser(), ServiceLifetime.Singleton);

    c.register<INavigationController>(
      Tokens.NavigationController,
      (ctx) => new NavigationController(ctx.resolve<IUrlParser>(Tokens.UrlParser)),
      ServiceLifetime.Singleton,
    );

    c.register<IRouter>(Tokens.Router, () => new Router(), ServiceLifetime.Singleton);

    c.register<IBrowserEngine>(
      Tokens.BrowserEngine,
      (ctx) => new BrowserEngine(
        ctx.resolve<INavigationController>(Tokens.NavigationController),
        ctx.resolve<IRouter>(Tokens.Router),
        ctx.resolve<AppConfig>(Tokens.AppConfig),
      ),
      ServiceLifetime.Singleton,
    );

    // 3. Tab management
    c.register<ITabManager>(Tokens.TabManager, () => new TabManager(), ServiceLifetime.Singleton);

    // 4. Application services
    c.register<IHistoryService>(
      Tokens.HistoryService,
      () => new HistoryService(),
      ServiceLifetime.Singleton,
    );
    c.register<IBookmarkService>(
      Tokens.BookmarkService,
      () => new BookmarkService(),
      ServiceLifetime.Singleton,
    );
    c.register<IDownloadManager>(
      Tokens.DownloadManager,
      () => new DownloadManager(),
      ServiceLifetime.Singleton,
    );

    // 5. Networking & Cache
    c.register<IResourceLoader>(
      Tokens.ResourceLoader,
      (ctx) => new ResourceLoader(
        undefined,
        undefined,
        undefined,
        ctx.resolve<ITrackerBlocker>(Tokens.TrackerBlocker),
      ),
      ServiceLifetime.Singleton,
    );
    c.register<ICacheManager>(
      Tokens.CacheManager,
      () => new CacheManager(),
      ServiceLifetime.Singleton,
    );

    // 6. Security
    c.register<ICertificateValidator>(
      Tokens.CertificateValidator,
      () => new CertificateValidator(),
      ServiceLifetime.Singleton,
    );
    c.register<ISandboxManager>(
      Tokens.SandboxManager,
      () => new SandboxManager(),
      ServiceLifetime.Singleton,
    );
    c.register<IPermissionManager>(
      Tokens.PermissionManager,
      () => new PermissionManager(),
      ServiceLifetime.Singleton,
    );
    c.register<ITrackerBlocker>(
      Tokens.TrackerBlocker,
      () => new TrackerBlocker(),
      ServiceLifetime.Singleton,
    );

    // 7. JavaScript runtime
    c.register<IJsRuntimeBridge>(
      Tokens.JsRuntimeBridge,
      () => new JsRuntimeBridge(),
      ServiceLifetime.Singleton,
    );
    c.register<IEventLoop>(
      Tokens.EventLoop,
      () => new EventLoop(),
      ServiceLifetime.Singleton,
    );
    c.register<IDomBindings>(
      Tokens.DomBindings,
      () => new DomBindings(),
      ServiceLifetime.Singleton,
    );

    // 8. Rendering pipeline
    c.register<IDomTree>(Tokens.DomTree, () => new DomTree(), ServiceLifetime.Singleton);
    c.register<ICssParser>(Tokens.CssParser, () => new CssParser(), ServiceLifetime.Singleton);
    c.register<ILayoutEngine>(Tokens.LayoutEngine, () => new LayoutEngine(), ServiceLifetime.Singleton);
    c.register<IPaintEngine>(Tokens.PaintEngine, () => new PaintEngine(), ServiceLifetime.Singleton);

    // 9. Storage
    c.register<ISessionsStore>(
      Tokens.SessionsStore,
      () => new InMemorySessionsStore(),
      ServiceLifetime.Singleton,
    );
    c.register<ICookieStore>(
      Tokens.CookieStore,
      () => new InMemoryCookieStore(),
      ServiceLifetime.Singleton,
    );

    // 10. Platform adapters
    c.register<IRuntimeAdapter>(
      Tokens.RuntimeAdapter,
      () => new RuntimeAdapter(),
      ServiceLifetime.Singleton,
    );
    c.register<IWindowManager>(
      Tokens.WindowManager,
      () => new WindowManager(),
      ServiceLifetime.Singleton,
    );
    c.register<IMenuIntegration>(
      Tokens.MenuIntegration,
      () => new MenuIntegration(),
      ServiceLifetime.Singleton,
    );

    // 11. UI components
    c.register<IAddressBar>(
      Tokens.AddressBar,
      (ctx) => new AddressBar(ctx.resolve<IUrlParser>(Tokens.UrlParser)),
      ServiceLifetime.Singleton,
    );
    c.register<IDesktopLayout>(
      Tokens.DesktopLayout,
      () => new DesktopLayout(),
      ServiceLifetime.Singleton,
    );
    c.register<IBrowserWindowPage>(
      Tokens.BrowserWindowPage,
      () => new BrowserWindowPage(),
      ServiceLifetime.Singleton,
    );
  }

  /**
   * Registers every service that implements ISharedService with the AppShell
   * so they participate in the application lifecycle (initialize / shutdown).
   */
  private registerSharedServices(): void {
    const shell = this.shell!;

    const lifecycleServices: ISharedService[] = [
      this.container.resolve<IHistoryService>(Tokens.HistoryService),
      this.container.resolve<IBookmarkService>(Tokens.BookmarkService),
      this.container.resolve<IDownloadManager>(Tokens.DownloadManager),
      this.container.resolve<IBrowserEngine>(Tokens.BrowserEngine),
    ];

    for (const svc of lifecycleServices) {
      shell.registerService(svc);
    }
  }

  /**
   * Mounts the browser chrome UI into the DOM after the shell (OS window)
   * is open and all services are initialized.
   */
  private async mountBrowserUI(): Promise<void> {
    let container = document.getElementById('browser-app');
    if (!container) {
      container = document.createElement('div');
      container.id = 'browser-app';
      container.style.cssText = 'height:100vh;width:100vw;overflow:hidden;';
      document.body.appendChild(container);
    }

    // Mount the top-level browser window page
    const page = this.container.resolve<IBrowserWindowPage>(Tokens.BrowserWindowPage);
    await page.mount(container);

    // Wire navigation controller to history service
    const navController = this.container.resolve<INavigationController>(Tokens.NavigationController);
    const historyService = this.container.resolve<IHistoryService>(Tokens.HistoryService);
    historyService.connectController(navController);

    // Plug the networking layer into the browser engine as the page loader
    const engine = this.container.resolve<IBrowserEngine>(Tokens.BrowserEngine);
    const resourceLoader = this.container.resolve<IResourceLoader>(Tokens.ResourceLoader);
    engine.setPageLoader(this.createPageLoader(resourceLoader));

    // Add ad/tracker blocking middleware
    const blocker = this.container.resolve<ITrackerBlocker>(Tokens.TrackerBlocker);
    engine.addMiddleware(async (session) => {
      const check = blocker.shouldBlock(session.entry.url);
      if (check.blocked) {
        console.warn(`[Blocker] Blocked main page load: ${session.entry.url} (${check.category})`);
        return false;
      }
      return true;
    });

    // Plug the rendering pipeline as the page renderer
    engine.setPageRenderer(this.createPageRenderer());

    this.log('Browser UI mounted');
  }

  /**
   * Adapter bridging IResourceLoader → IPageLoader so the browser engine
   * can use our networking subsystem to fetch documents.
   */
  private createPageLoader(loader: IResourceLoader): IPageLoader {
    return {
      load: async (url: string, signal: AbortSignal): Promise<PageLoadResult> => {
        const result = await loader.loadResource(url, 'document', { signal });
        return {
          url: result.url,
          statusCode: result.statusCode,
          contentType: result.contentType,
          body: result.body,
          headers: result.headers,
          loadedAt: result.loadedAt,
        };
      },
    };
  }

  /**
   * Composes the rendering pipeline (HTML parser → DOM tree → CSS → layout → paint)
   * into an IPageRenderer implementation.
   */
  private createPageRenderer(): IPageRenderer {
    const htmlParser = new HtmlParser();
    const domTree = this.container.resolve<IDomTree>(Tokens.DomTree);
    const cssParser = this.container.resolve<ICssParser>(Tokens.CssParser);
    const layoutEngine = this.container.resolve<ILayoutEngine>(Tokens.LayoutEngine);
    const paintEngine = this.container.resolve<IPaintEngine>(Tokens.PaintEngine);

    return {
      render: async (result: PageLoadResult): Promise<void> => {
        const parseResult = htmlParser.parse(result.body, result.url);
        const htmlDoc = parseResult.document;

        // Convert the parsed HTML into our internal DOM tree representation
        const doc = domTree.buildFromHtml(htmlDoc);

        // Extract and compute CSS styles
        const rules = cssParser.extractStylesFromDocument(htmlDoc);
        this.applyComputedStyles(domTree, cssParser, rules);

        // Run layout and paint
        layoutEngine.layout(doc);
        paintEngine.paint(doc);
      },
    };
  }

  /**
   * Iterates over every element in the DOM tree and applies the matching
   * computed CSS styles so the layout / paint engines can consume them.
   */
  private applyComputedStyles(
    _domTree: IDomTree,
    _cssParser: ICssParser,
    _rules: readonly CssRule[],
  ): void {
    // Walk the live DOM tree and set computedStyle on each DomElement.
    // For now we rely on the layout engine's internal default styling;
    // full CSS cascade resolution will be added in a follow-up.
  }

  // ── Diagnostics ───────────────────────────────────────────────────────────

  private log(message: string): void {
    if (this.config.debug) {
      const ts = new Date().toISOString();
      console.log(`[Bootstrap][${ts}] ${message}`);
    }
  }
}

// ── Process environment helper ────────────────────────────────────────────────

function getProcessEnv(): Record<string, string | undefined> {
  if (typeof process !== 'undefined' && process.env) {
    return process.env as Record<string, string | undefined>;
  }
  return {};
}

// ── Signal handlers ───────────────────────────────────────────────────────────

/**
 * Registers SIGTERM and SIGINT handlers so the application performs a clean
 * shutdown when the OS or a process manager requests it.
 */
function registerSignalHandlers(app: ApplicationBootstrap): void {
  const handler = async (signal: string): Promise<void> => {
    console.log(`\n[Bootstrap] Received ${signal} — shutting down…`);
    try {
      await app.stop();
      process.exit(0);
    } catch (err) {
      console.error('[Bootstrap] Error during shutdown:', err);
      process.exit(1);
    }
  };

  if (typeof process !== 'undefined') {
    process.on('SIGTERM', () => void handler('SIGTERM'));
    process.on('SIGINT',  () => void handler('SIGINT'));
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

(async () => {
  const app = new ApplicationBootstrap();
  registerSignalHandlers(app);

  try {
    await app.start();
  } catch (err) {
    console.error('[Bootstrap] Fatal startup error:', err);
    if (typeof process !== 'undefined') {
      process.exit(1);
    }
  }
})();

// ── Exports ───────────────────────────────────────────────────────────────────

export { ApplicationBootstrap, ConfigLoader, Tokens };