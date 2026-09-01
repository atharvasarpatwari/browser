/**
 * @file Application entry point and dependency injection container.
 *
 * Wires together all subsystems: navigation, rendering, networking, security,
 * storage, and UI.  The {@link ApplicationBootstrap} class orchestrates startup
 * and exposes the rendering pipeline via {@link createPageRenderer}.
 */
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
import { clearAllRegistrations as clearMutationObservers } from '../browser/rendering/html5/mutation-observer';

// Core navigation / engine
import { UrlParser } from '../browser/navigation/url-parser';
import type { IUrlParser } from '../browser/navigation/url-parser';
import { NavigationController } from '../browser/navigation/navigation-controller';
import type { INavigationController } from '../browser/navigation/navigation-controller';
import { Router } from '../browser/navigation/router';
import type { IRouter } from '../browser/navigation/router';
import { BrowserEngine } from '../browser/engine/browser-engine';
import type { IBrowserEngine } from '../browser/engine/browser-engine';

// Tab management
import { TabManager } from '../browser/tabs/tab-manager';
import type { ITabManager } from '../browser/tabs/tab-manager';

// Tab-process adapter (bridges TabContextManager ↔ ProcessManager)
import { TabProcessManager, createTabProcessManager, createChildProcessTabManager } from '../browser/engine/tab-process-adapter';
import type { ITabProcessManager } from '../browser/engine/tab-process-adapter';
import { TabContextManager } from '../browser/engine/tab-context';
import type { ITabContextManager } from '../browser/engine/tab-context';

// Crash recovery / isolation
import { ScriptGuard } from '../browser/engine/script-guard';
import type { IScriptGuard } from '../browser/engine/script-guard';
import { ErrorBoundary } from '../browser/engine/error-boundary';
import type { IErrorBoundary } from '../browser/engine/error-boundary';
import { CrashReporter, CrashReportBuilder } from '../browser/engine/crash-reporter';
import type { ICrashReporter } from '../browser/engine/crash-reporter';
import { ProcessGuard } from '../browser/engine/process-guard';
import type { IProcessGuard } from '../browser/engine/process-guard';
import { LifecycleManager } from '../browser/engine/lifecycle-manager';
import type { ILifecycleManager } from '../browser/engine/lifecycle-manager';

// Services
import { HistoryService } from '../browser/history/history-service';
import type { IHistoryService } from '../browser/history/history-service';
import { BookmarkService } from '../browser/bookmarks/bookmark-services';
import type { IBookmarkService } from '../browser/bookmarks/bookmark-services';
import { DownloadManager } from '../browser/downloads/download-manager';
import type { IDownloadManager } from '../browser/downloads/download-manager';

// Networking
import { ResourceLoader } from '../browser/networking/resource-loader';
import type { IResourceLoader } from '../browser/networking/resource-loader';
import { CacheManager } from '../browser/networking/cache-manager';
import type { ICacheManager } from '../browser/networking/cache-manager';
import { ResourcePrioritizer } from '../browser/networking/resource-prioritizer';
import { Firewall, applyBaselineRules } from '../browser/networking/firewall';
import { createFirewallGuardedNetworking, type FirewallGuardedNetworking } from '../browser/networking/networking-setup';
import { RawSocketHttpClient } from '../browser/networking/raw-socket-http-client';
import { ProxyAwareHttpClient, createProxyConfigFromEnv } from '../browser/networking/request-manager';
import type { IHttpClient } from '../browser/networking/request-manager';
import { TlsHandler } from '../browser/networking/tls-handler';
import type { ITlsHandler } from '../browser/networking/tls-handler';

// Security
import { CertificateValidator } from '../browser/security/certificate-validator';
import type { ICertificateValidator } from '../browser/security/certificate-validator';
import { SandboxManager } from '../browser/security/sandbox-manager';
import type { ISandboxManager } from '../browser/security/sandbox-manager';
import { PermissionManager } from '../browser/security/permission-manager';
import type { IPermissionManager } from '../browser/security/permission-manager';
import { TrackerBlocker } from '../browser/security/tracker-blocker';
import type { ITrackerBlocker } from '../browser/security/tracker-blocker';
import { AdBlocker } from '../browser/security/ad-blocker';
import type { IAdBlocker } from '../browser/security/ad-blocker';
import { ThirdPartySecurityManager, extractOrigin } from '../browser/security/third-party-security';
import type { IThirdPartySecurityManager } from '../browser/security/third-party-security';
import { createCspEnforcement, type CspEnforcement } from '../browser/security/csp-enforcement';
import { HtmlSanitizer } from '../browser/security/html-sanitizer';
import { SecurityLayer } from '../browser/media/security-layer';

// Rendering
import { DomTree } from '../browser/rendering/dom-tree';
import type { IDomTree } from '../browser/rendering/dom-tree';
import { CssParser } from '../browser/rendering/css-parser';
import type { ICssParser } from '../browser/rendering/css-parser';
import { LayoutEngine } from '../browser/rendering/layout-engine';
import type { ILayoutEngine } from '../browser/rendering/layout-engine';
import { PaintEngine } from '../browser/rendering/paint-engine';
import type { IPaintEngine } from '../browser/rendering/paint-engine';
import { HtmlParser } from '../browser/rendering/html-parser';

// PageLoader and PageRenderer
import { PageLoader, PageRenderer } from '../browser/engine/page-renderer';

// Storage
import {
  PersistentSessionsStore,
  PersistentCookieStore,
  PersistentBookmarkStore,
  PersistentHistoryStore,
  PersistentTokenStore,
} from '../browser/storage/persistent-stores';
import type { ISessionsStore } from '../browser/storage/sessions-store';
import type { ICookieStore } from '../browser/storage/cookie-store';
import { SettingsStore } from '../browser/storage/settings-store';
import type { ISettingsStore } from '../browser/storage/settings-store';
import { SettingsService } from '../browser/storage/settings-service';
import type { ISettingsService } from '../browser/storage/settings-service';
import { BrowserName } from '../browser/config/browser-name';
import type { IBrowserName } from '../browser/config/browser-name';

// Platform
import { RuntimeAdapter } from '../platform/shared/runtime-adapter';
import type { IRuntimeAdapter } from '../platform/shared/runtime-adapter';
import { WindowManager } from '../platform/desktop/window-manager';
import type { IWindowManager } from '../platform/desktop/window-manager';
import { MenuIntegration } from '../platform/desktop/menu-integration';
import type { IMenuIntegration } from '../platform/desktop/menu-integration';
import { InputManager } from '../platform/shared/input-manager';
import type { IInputManager } from '../platform/shared/input-manager';
import { WindowControls } from '../platform/shared/window-controls';
import type { IWindowControls } from '../platform/shared/window-controls';

// UI
import { AddressBar } from '../ui/components/address-bar/address-bar';
import type { IAddressBar } from '../ui/components/address-bar/address-bar';
import { DesktopLayout } from '../ui/layout/desktop-layout';
import type { IDesktopLayout } from '../ui/layout/desktop-layout';
import { BrowserWindowPage } from '../ui/pages/browser-window';
import type { IBrowserWindowPage } from '../ui/pages/browser-window';
import { isNativeHostPresent, installAndroidNativeBridge } from './android-native-bridge';

// Auth
import { AuthManager } from '../browser/auth/auth-manager';
import type { IAuthManager } from '../browser/auth/auth-manager';
import type { ITokenStore } from '../browser/auth/token-store';

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
  TlsHandler: Symbol('TlsHandler'),
  SandboxManager: Symbol('SandboxManager'),
  PermissionManager: Symbol('PermissionManager'),
  TrackerBlocker: Symbol('TrackerBlocker'),
  AdBlocker: Symbol('AdBlocker'),
  ThirdPartySecurityManager: Symbol('ThirdPartySecurityManager'),
  SecurityLayer: Symbol('SecurityLayer'),
  DomTree: Symbol('DomTree'),
  CssParser: Symbol('CssParser'),
  LayoutEngine: Symbol('LayoutEngine'),
  PaintEngine: Symbol('PaintEngine'),
  SessionsStore: Symbol('SessionsStore'),
  CookieStore: Symbol('CookieStore'),
  RuntimeAdapter: Symbol('RuntimeAdapter'),
  WindowManager: Symbol('WindowManager'),
  MenuIntegration: Symbol('MenuIntegration'),
  InputManager: Symbol('InputManager'),
  WindowControls: Symbol('WindowControls'),
  AddressBar: Symbol('AddressBar'),
  DesktopLayout: Symbol('DesktopLayout'),
  BrowserWindowPage: Symbol('BrowserWindowPage'),
  AuthManager: Symbol('AuthManager'),
  TokenStore: Symbol('TokenStore'),
  // Crash recovery / isolation
  ScriptGuard: Symbol('ScriptGuard'),
  ErrorBoundary: Symbol('ErrorBoundary'),
  CrashReporter: Symbol('CrashReporter'),
  ProcessGuard: Symbol('ProcessGuard'),
  LifecycleManager: Symbol('LifecycleManager'),
  // Tab-process adapter
  TabContextManager: Symbol('TabContextManager'),
  TabProcessManager: Symbol('TabProcessManager'),
  // Firewall
  Firewall: Symbol('Firewall'),
  FirewallGuardedNetworking: Symbol('FirewallGuardedNetworking'),
  // Settings
  SettingsStore: Symbol('SettingsStore'),
  SettingsService: Symbol('SettingsService'),
  // Browser identity
  BrowserName: Symbol('BrowserName'),
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
      ...DEFAULT_CONFIG,
      version: this.string('APP_VERSION', DEFAULT_CONFIG.version),
      debug: this.boolean('DEBUG', DEFAULT_CONFIG.debug),
      maxTabs: this.integer('MAX_TABS', DEFAULT_CONFIG.maxTabs),
      homePage: this.string('HOME_PAGE', DEFAULT_CONFIG.homePage),
      userAgent: this.string('USER_AGENT', DEFAULT_CONFIG.userAgent),
      browserName: this.string('BROWSER_NAME', DEFAULT_CONFIG.browserName),
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

    this.startPlatformServices();

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
    clearMutationObservers();
    this.running = false;
    this.log('Stopped');
  }

  isRunning(): boolean {
    return this.running;
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
      () => new HistoryService(
        new PersistentHistoryStore(typeof window !== 'undefined' ? window.localStorage : undefined),
      ),
      ServiceLifetime.Singleton,
    );
    c.register<IBookmarkService>(
      Tokens.BookmarkService,
      () => new BookmarkService(
        new PersistentBookmarkStore(typeof window !== 'undefined' ? window.localStorage : undefined),
      ),
      ServiceLifetime.Singleton,
    );
    c.register<IDownloadManager>(
      Tokens.DownloadManager,
      () => new DownloadManager(),
      ServiceLifetime.Singleton,
    );

    // 5. Networking & Cache
    c.register<ITlsHandler>(
      Tokens.TlsHandler,
      () => new TlsHandler({ useRealTls: true, verifyCertificates: true }),
      ServiceLifetime.Singleton,
    );
    c.register<IResourceLoader>(
      Tokens.ResourceLoader,
      (ctx) => {
        const isNode =
          typeof process !== 'undefined' &&
          typeof (process as { versions?: { node?: string } }).versions?.node === 'string';
        const tlsHandler = ctx.resolve<ITlsHandler>(Tokens.TlsHandler);
        const proxyConfig = createProxyConfigFromEnv();
        let client: IHttpClient | undefined;
        if (proxyConfig.socksProxy || proxyConfig.httpProxy || proxyConfig.httpsProxy) {
          client = new ProxyAwareHttpClient(proxyConfig, undefined, tlsHandler);
        } else if (isNode) {
          client = new RawSocketHttpClient({ tlsHandler });
        }
        const cache = ctx.resolve<ICacheManager>(Tokens.CacheManager);
        const loader = new ResourceLoader(
          client,
          undefined,
          undefined,
          ctx.resolve<ITrackerBlocker>(Tokens.TrackerBlocker),
        );
        loader.setCache(cache);
        return loader;
      },
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
    c.register<IAdBlocker>(
      Tokens.AdBlocker,
      () => new AdBlocker(),
      ServiceLifetime.Singleton,
    );
    c.register<IThirdPartySecurityManager>(
      Tokens.ThirdPartySecurityManager,
      () => new ThirdPartySecurityManager(),
      ServiceLifetime.Singleton,
    );

    // 6b. CSP enforcement (8 modules wired together)
    c.register<CspEnforcement>(
      'CspEnforcement' as any,
      () => createCspEnforcement(),
      ServiceLifetime.Singleton,
    );

    // 6c. Full security layer — aggregates all 18 media security modules
    c.register<SecurityLayer>(
      Tokens.SecurityLayer,
      () => new SecurityLayer(),
      ServiceLifetime.Singleton,
    );

    // 7. Rendering pipeline
    c.register<IDomTree>(Tokens.DomTree, () => new DomTree(), ServiceLifetime.Singleton);
    c.register<ICssParser>(Tokens.CssParser, () => new CssParser(), ServiceLifetime.Singleton);
    c.register<ILayoutEngine>(Tokens.LayoutEngine, () => new LayoutEngine(), ServiceLifetime.Singleton);
    c.register<IPaintEngine>(
      Tokens.PaintEngine,
      (ctx) =>
        new PaintEngine({
          hardwareAcceleration: ctx.resolve<AppConfig>(Tokens.AppConfig).processModel.enableGpuAcceleration,
        }),
      ServiceLifetime.Singleton,
    );

    // 9. Storage
    c.register<ISessionsStore>(
      Tokens.SessionsStore,
      () => new PersistentSessionsStore(typeof window !== 'undefined' ? window.localStorage : undefined),
      ServiceLifetime.Singleton,
    );
    c.register<ICookieStore>(
      Tokens.CookieStore,
      () => new PersistentCookieStore(typeof window !== 'undefined' ? window.localStorage : undefined),
      ServiceLifetime.Singleton,
    );

    // 9b. Settings persistence & service
    c.register<ISettingsStore>(
      Tokens.SettingsStore,
      () => new SettingsStore(typeof window !== 'undefined' ? window.localStorage : undefined),
      ServiceLifetime.Singleton,
    );
    c.register<ISettingsService>(
      Tokens.SettingsService,
      (ctx) => new SettingsService(ctx.resolve<ISettingsStore>(Tokens.SettingsStore)),
      ServiceLifetime.Singleton,
    );
    c.register<IBrowserName>(
      Tokens.BrowserName,
      () => new BrowserName(),
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
    c.register<IInputManager>(
      Tokens.InputManager,
      () => new InputManager(),
      ServiceLifetime.Singleton,
    );
    c.register<IWindowControls>(
      Tokens.WindowControls,
      () => new WindowControls(),
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
      // hideChromeUI: when the Android native shell is present (NovaStateBridge
      // registered before this script runs), the native Compose chrome drives
      // navigation instead of this page's own toolbar/tab-strip — see
      // android-native-bridge.ts.
      () => new BrowserWindowPage({ hideChromeUI: isNativeHostPresent() }),
      ServiceLifetime.Singleton,
    );

    // 12. Authentication
    c.register<ITokenStore>(
      Tokens.TokenStore,
      () => new PersistentTokenStore(
        {
          maxTokensPerProvider: 10,
          autoCleanupExpired: true,
          masterKey: 'nova-browser-default-key',
        },
        typeof window !== 'undefined' ? window.localStorage : undefined,
      ),
      ServiceLifetime.Singleton,
    );
    c.register<IAuthManager>(
      Tokens.AuthManager,
      (ctx) => new AuthManager(ctx.resolve<ITokenStore>(Tokens.TokenStore)),
      ServiceLifetime.Singleton,
    );

    // 13. Crash recovery / isolation
    c.register<IScriptGuard>(
      Tokens.ScriptGuard,
      () => new ScriptGuard(),
      ServiceLifetime.Singleton,
    );
    c.register<IErrorBoundary>(
      Tokens.ErrorBoundary,
      () => new ErrorBoundary({ name: 'main-boundary', strategy: 'retry', maxRetries: 2 }),
      ServiceLifetime.Singleton,
    );
    c.register<ICrashReporter>(
      Tokens.CrashReporter,
      () => new CrashReporter({ maxReports: 200, logReports: true }),
      ServiceLifetime.Singleton,
    );
    c.register<IProcessGuard>(
      Tokens.ProcessGuard,
      () => new ProcessGuard({ installHandlers: true, logErrors: true }),
      ServiceLifetime.Singleton,
    );

    // 14. Tab-process adapter
    c.register<ITabContextManager>(
      Tokens.TabContextManager,
      () => new TabContextManager(),
      ServiceLifetime.Singleton,
    );

    // 15. Firewall
    c.register<Firewall>(
      Tokens.Firewall,
      () => {
        const fw = new Firewall({ blockPrivateNetworksByDefault: true });
        applyBaselineRules(fw);
        return fw;
      },
      ServiceLifetime.Singleton,
    );
    c.register<FirewallGuardedNetworking>(
      Tokens.FirewallGuardedNetworking,
      () => createFirewallGuardedNetworking({ applyBaseline: false }),
      ServiceLifetime.Singleton,
    );
  }

  /**
   * Registers every service that implements ISharedService with the AppShell
   * so they participate in the application lifecycle (initialize / shutdown).
   */
  private startPlatformServices(): void {
    // Input & window controls are resolved early so their window listeners
    // are active for the whole session. Both implement IDisposable, so the
    // container disposes them automatically during shutdown.
    try {
      this.container.resolve<IInputManager>(Tokens.InputManager).start();
      this.container.resolve<IWindowControls>(Tokens.WindowControls).start();
    } catch (err) {
      console.error('[Bootstrap] Failed to start platform services:', err);
    }
  }

  private registerSharedServices(): void {
    const shell = this.shell!;

    const lifecycleServices: ISharedService[] = [
      this.container.resolve<IHistoryService>(Tokens.HistoryService),
      this.container.resolve<IBookmarkService>(Tokens.BookmarkService),
      this.container.resolve<IDownloadManager>(Tokens.DownloadManager),
      this.container.resolve<IBrowserEngine>(Tokens.BrowserEngine),
      this.container.resolve<IProcessGuard>(Tokens.ProcessGuard),
    ];

    for (const svc of lifecycleServices) {
      shell.registerService(svc);
    }

    // Wire the TabProcessManager after shell is ready — it bridges
    // TabContextManager ↔ ProcessManager for unified tab+process lifecycle.
    this.wireTabProcessManager();
  }

  /**
   * Creates a TabProcessManager that bridges TabContextManager and the IPC
   * ProcessManager. On startup it becomes the unified tab+process API.
   * Process crash events are automatically forwarded to the CrashReporter.
   */
  private async wireTabProcessManager(): Promise<void> {
    try {
      const config = this.container.resolve<AppConfig>(Tokens.AppConfig);
      const processModel = config.processModel;
      
      let tabProcessManager: TabProcessManager;
      
      if (processModel.enableRendererIsolation && processModel.isolationMode !== 'none') {
        // Use child-process mode for renderer isolation
        console.log(`[Bootstrap] Using child-process mode (${processModel.isolationMode})`);
        tabProcessManager = await createChildProcessTabManager(
          processModel.rendererEntryPath,
          { processConfig: { maxProcesses: processModel.maxRendererProcesses || 20 } }
        );
      } else {
        // Use in-process mode (default)
        console.log('[Bootstrap] Using in-process mode');
        tabProcessManager = await createTabProcessManager();
      }
      
      this.container.registerValue<ITabProcessManager>(Tokens.TabProcessManager, tabProcessManager);

      const crashReporter = this.container.resolve<ICrashReporter>(Tokens.CrashReporter);
      tabProcessManager.on('tabProcessCrashed', (event) => {
        if (event.kind !== 'tabProcessCrashed') return;
        const report = new CrashReportBuilder()
          .source('tab-context')
          .error(event.error)
          .severity('error')
          .phase('script')
          .tabId(event.tabId)
          .context('processId', event.processId)
          .build();
        crashReporter.report(report);
      });

      console.log('[Bootstrap] TabProcessManager wired');
    } catch (err) {
      console.error('[Bootstrap] Failed to wire TabProcessManager:', err);
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

    // If a native Android shell registered its bridge before this script ran,
    // wire window.novaNative and start pushing tab/nav state to it. No-op on
    // desktop/Electron/plain web, where NovaStateBridge is never present.
    installAndroidNativeBridge(page);

    // Wire navigation controller to history service
    const navController = this.container.resolve<INavigationController>(Tokens.NavigationController);
    const historyService = this.container.resolve<IHistoryService>(Tokens.HistoryService);
    historyService.connectController(navController);

    // Wire CSP navigation guard into controller
    const cspEnforcement = this.container.resolve<CspEnforcement>('CspEnforcement' as any);
    navController.addGuard(cspEnforcement.navigationGuard);

    // Wire the full security layer guard into the controller (HTTPS/HSTS/DNS/PNA)
    const securityLayer = this.container.resolve<SecurityLayer>(Tokens.SecurityLayer);
    navController.addGuard(securityLayer.navigationGuard);

    // Plug the networking layer into the browser engine as the page loader
    const engine = this.container.resolve<IBrowserEngine>(Tokens.BrowserEngine);
    const resourceLoader = this.container.resolve<IResourceLoader>(Tokens.ResourceLoader);
    engine.setPageLoader(new PageLoader(resourceLoader));

    // Add ad blocking middleware
    const adBlocker = this.container.resolve<IAdBlocker>(Tokens.AdBlocker);
    engine.addMiddleware(async (session) => {
      const check = adBlocker.shouldBlock(session.entry.url);
      if (check.blocked) {
        console.warn(`[AdBlocker] Blocked ad page load: ${session.entry.url} (${check.match!.rule.category})`);
        return false;
      }
      return true;
    });

    // Add tracker blocking middleware
    const blocker = this.container.resolve<ITrackerBlocker>(Tokens.TrackerBlocker);
    engine.addMiddleware(async (session) => {
      const check = blocker.shouldBlock(session.entry.url);
      if (check.blocked) {
        console.warn(`[Blocker] Blocked main page load: ${session.entry.url} (${check.category})`);
        return false;
      }
      return true;
    });

    // Add third-party security middleware
    const thirdPartySecurity = this.container.resolve<IThirdPartySecurityManager>(Tokens.ThirdPartySecurityManager);
    engine.addMiddleware(async (session) => {
      const pageOrigin = extractOrigin(session.entry.url);
      const check = thirdPartySecurity.checkFetchAllowed(pageOrigin, pageOrigin, session.entry.url);
      if (!check.allowed) {
        console.warn(`[ThirdPartySecurity] Blocked fetch: ${session.entry.url} (${check.reason})`);
        return false;
      }
      return true;
    });

    // Add security-layer middleware (runs after routing, before fetching)
    engine.addMiddleware(async (session) => {
      const check = securityLayer.checkNavigation(session.entry.url);
      if (!check.allowed) {
        console.warn(`[SecurityLayer] Blocked navigation: ${session.entry.url} (${check.reason ?? 'denied'})`);
        return false;
      }
      return true;
    });

    // Plug the rendering pipeline as the page renderer
    const pageRenderer = new PageRenderer({
      htmlParser: new HtmlParser(),
      domTree: this.container.resolve<IDomTree>(Tokens.DomTree),
      cssParser: this.container.resolve<ICssParser>(Tokens.CssParser),
      layoutEngine: this.container.resolve<ILayoutEngine>(Tokens.LayoutEngine),
      paintEngine: this.container.resolve<IPaintEngine>(Tokens.PaintEngine),
      resourceLoader,
      prioritizer: new ResourcePrioritizer(),
      controller: this.container.resolve<INavigationController>(Tokens.NavigationController),
      sanitizer: new HtmlSanitizer(),
      scriptEnforcer: cspEnforcement.scriptEnforcer,
      resourceEnforcer: cspEnforcement.resourceEnforcer,
      securityLayer,
      onFrameRendered: () => engine.notifyPageRepainted(),
    });
    engine.setPageRenderer(pageRenderer);

    this.log('Browser UI mounted');

    // Wire DI services into BrowserWindowPage
    const paintEngine = this.container.resolve<IPaintEngine>(Tokens.PaintEngine);
    const downloadManager = this.container.resolve<IDownloadManager>(Tokens.DownloadManager);
    const bookmarkService = this.container.resolve<IBookmarkService>(Tokens.BookmarkService);
    const historyServiceInstance = this.container.resolve<IHistoryService>(Tokens.HistoryService);

    page.setBrowserEngine(engine);
    page.setNavigationController(navController);
    page.setPaintEngine(paintEngine);
    page.setDownloadManager(downloadManager);
    page.setBookmarkService(bookmarkService);
    page.setHistoryService(historyServiceInstance);

    // Wire DI-registered blockers into the page so shield toggle affects engine middleware
    page.setTrackerBlocker(blocker);
    page.setAdBlocker(adBlocker);

    // Wire SettingsService → BrowserWindowPage so nova://settings gets persistence
    const settingsService = this.container.resolve<ISettingsService>(Tokens.SettingsService);
    page.setSettingsService(settingsService);

    // Initialize BrowserName from settings
    const browserName = this.container.resolve<IBrowserName>(Tokens.BrowserName);
    browserName.init(settingsService);
    page.setBrowserName(browserName);
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

// ── Renderer health probe ─────────────────────────────────────────────────────
//
// Exposes a probe the Electron main-process watchdog pings to confirm the
// renderer (and its mounted chrome) is alive. Returns a small serializable
// status object; never throws.

function installRendererHealthProbe(startedAt: number, getApp: () => { running(): boolean }): void {
  const host = (globalThis as unknown as Record<string, unknown>);
  host.__novaHealthProbe = (): Record<string, unknown> => {
    const mounted = document.getElementById('browser-app') !== null;
    return {
      ok: getApp().running() && mounted,
      running: getApp().running(),
      mounted,
      uptimeMs: Date.now() - startedAt,
      title: document.title,
      readyState: document.readyState,
    };
  };
}

// ── Entry point ───────────────────────────────────────────────────────────────

(async () => {
  const startedAt = Date.now();
  const app = new ApplicationBootstrap();
  registerSignalHandlers(app);
  installRendererHealthProbe(startedAt, () => ({ running: () => app.isRunning() }));

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