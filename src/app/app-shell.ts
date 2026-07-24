/**
 * @file app-shell.ts
 * @layer App Bootstrap — Session 1 / File 2
 *
 * The AppShell is the topmost runtime object.  It owns:
 *   • the primary BrowserWindow (OS-level or Electron-level window)
 *   • the registry of ISharedServices (event bus, theme, telemetry, …)
 *   • the mount / unmount lifecycle
 *
 * OOP principles applied
 * ─────────────────────
 *   Abstraction      — IAppShell and IWindow hide implementation detail from consumers.
 *   Encapsulation    — window reference and service map are private; mutated only
 *                      through defined lifecycle methods.
 *   Single-Resp.     — AppShell coordinates; BrowserWindow owns only window state.
 *   Interface-Seg.   — ISharedService is minimal so services are not forced to
 *                      implement methods they do not need.
 *   Dependency-Inv.  — AppShell receives IServiceContainer, not the concrete class.
 *   Open/Closed      — New shared services are registered without altering AppShell.
 */

import type { IServiceContainer } from './dependency-container';
import type { ProcessModelConfig } from './config/process-model';
import { DEFAULT_PROCESS_MODEL } from './config/process-model';

// ── Configuration ─────────────────────────────────────────────────────────────

/**
 * Immutable application-wide configuration loaded once at startup.
 * Defined here so main.ts can import it without circular dependency.
 */
interface AppConfig {
  /** Semver build version (e.g. "1.0.0"). */
  readonly version: string;
  /** Emit verbose diagnostic output when true. */
  readonly debug: boolean;
  /** Upper limit on concurrent open tabs. */
  readonly maxTabs: number;
  /** Default URL opened in a new tab. */
  readonly homePage: string;
  /** User-Agent string sent with every request. */
  readonly userAgent: string;
  /** Browser name displayed in title bar, new tab, and branding. */
  readonly browserName: string;
  /** Process model configuration for browser/renderer separation. */
  readonly processModel: ProcessModelConfig;
}

/** Reasonable defaults used when environment variables are absent. */
const DEFAULT_CONFIG: AppConfig = {
  version: '1.0.0',
  debug: false,
  maxTabs: 20,
  homePage: 'about:blank',
  userAgent: 'NovaBrowser/1.0',
  browserName: 'Nova Browser',
  processModel: DEFAULT_PROCESS_MODEL,
};

// ── Shared-service interface ───────────────────────────────────────────────────

/**
 * Contract for any service that wants to participate in the shell lifecycle.
 * Services are initialized before the window opens and shut down after it closes.
 */
interface ISharedService {
  /** Human-readable identifier used for logging and look-up. */
  readonly name: string;
  /** Called by AppShell before the window is shown. */
  initialize(): Promise<void>;
  /** Called by AppShell after the window is closed. */
  shutdown(): Promise<void>;
}

// ── Window interface ───────────────────────────────────────────────────────────

/** Public API for the browser's top-level OS window. */
interface IWindow {
  readonly id: string;
  readonly title: string;
  readonly isOpen: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
  focus(): void;
  setTitle(title: string): void;
}

// ── Shell interface ────────────────────────────────────────────────────────────

interface IAppShell {
  /** Initializes services, opens the main window, and marks the shell as mounted. */
  mount(): Promise<void>;
  /** Closes the window and shuts down services in reverse-registration order. */
  unmount(): Promise<void>;
  /** Returns the active IWindow, or null before mount() / after unmount(). */
  getWindow(): IWindow | null;
  /** Look up a registered shared service by name. */
  getService<T extends ISharedService>(name: string): T | undefined;
  /** Registers a service that participates in the shell's lifecycle. Must be called before mount(). */
  registerService(service: ISharedService): this;
  readonly isMounted: boolean;
}

// ── BrowserWindow ──────────────────────────────────────────────────────────────

/**
 * Wraps the actual OS / Electron window.
 *
 * Responsibilities
 * ─────────────────
 *   • Track open/closed state so callers cannot double-open or focus a closed window.
 *   • Expose title mutation so the navigation layer can update the chrome.
 *
 * In a real implementation open() would call Electron's `new BrowserWindow(…)`
 * or the native windowing API.  The stub logs to console so the rest of the
 * bootstrap can be exercised without a display server.
 */
class BrowserWindow implements IWindow {
  readonly id: string;

  private _title: string;
  private _open = false;

  constructor(id: string, title: string) {
    this.id = id;
    this._title = title;
  }

  get title(): string {
    return this._title;
  }

  get isOpen(): boolean {
    return this._open;
  }

  async open(): Promise<void> {
    if (this._open) {
      return;   // idempotent
    }
    // TODO: create native / Electron window
    console.log(`[BrowserWindow:${this.id}] Opened — "${this._title}"`);
    this._open = true;
  }

  async close(): Promise<void> {
    if (!this._open) {
      return;   // idempotent
    }
    // TODO: destroy native / Electron window
    console.log(`[BrowserWindow:${this.id}] Closed`);
    this._open = false;
  }

  focus(): void {
    if (!this._open) {
      throw new Error(`Cannot focus window "${this.id}" — it is not open.`);
    }
    // TODO: bring window to foreground
    console.log(`[BrowserWindow:${this.id}] Focused`);
  }

  setTitle(title: string): void {
    this._title = title;
    if (this._open) {
      // TODO: push to native window title bar
      console.log(`[BrowserWindow:${this.id}] Title updated → "${title}"`);
    }
  }
}

// ── WindowLifecycleError ───────────────────────────────────────────────────────

class WindowLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WindowLifecycleError';
  }
}

// ── AppShell ───────────────────────────────────────────────────────────────────

/**
 * Coordinates the entire application shell lifecycle.
 *
 * Mount sequence
 * ──────────────
 *   1. Initialize all registered shared services (in registration order).
 *   2. Create and open the primary BrowserWindow.
 *   3. Focus the window.
 *   4. Mark shell as mounted.
 *
 * Unmount sequence
 * ────────────────
 *   1. Close the BrowserWindow.
 *   2. Shut down shared services in reverse registration order.
 *   3. Mark shell as unmounted.
 */
class AppShell implements IAppShell {
  private readonly container: IServiceContainer;
  private readonly config: AppConfig;

  // Insertion-ordered map preserves registration order for lifecycle management.
  private readonly serviceRegistry = new Map<string, ISharedService>();

  private _window: IWindow | null = null;
  private _mounted = false;

  constructor(container: IServiceContainer, config: AppConfig) {
    this.container = container;
    this.config = config;
  }

  get isMounted(): boolean {
    return this._mounted;
  }

  // ── Service registration ───────────────────────────────────────────────────

  registerService(service: ISharedService): this {
    if (this._mounted) {
      throw new WindowLifecycleError(
        `Cannot register service "${service.name}" after the shell has been mounted.`,
      );
    }
    if (this.serviceRegistry.has(service.name)) {
      throw new Error(`A service named "${service.name}" is already registered.`);
    }
    this.serviceRegistry.set(service.name, service);
    return this;
  }

  getService<T extends ISharedService>(name: string): T | undefined {
    return this.serviceRegistry.get(name) as T | undefined;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async mount(): Promise<void> {
    if (this._mounted) {
      return;   // idempotent
    }

    this.log('Mounting…');

    await this.initializeServices();

    this._window = new BrowserWindow(
      'main',
      `${this.config.browserName} v${this.config.version}`,
    );
    await this._window.open();
    this._window.focus();

    this._mounted = true;
    this.log('Mounted');
  }

  async unmount(): Promise<void> {
    if (!this._mounted) {
      return;   // idempotent
    }

    this.log('Unmounting…');

    if (this._window?.isOpen) {
      await this._window.close();
    }
    this._window = null;

    await this.shutdownServices();

    this._mounted = false;
    this.log('Unmounted');
  }

  getWindow(): IWindow | null {
    return this._window;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async initializeServices(): Promise<void> {
    for (const [name, service] of this.serviceRegistry) {
      this.log(`Initializing service: ${name}`);
      await service.initialize();
    }
  }

  private async shutdownServices(): Promise<void> {
    const reversed = [...this.serviceRegistry.entries()].reverse();
    for (const [name, service] of reversed) {
      this.log(`Shutting down service: ${name}`);
      try {
        await service.shutdown();
      } catch (err) {
        // Do not abort shutdown chain on individual failures.
        console.error(`[AppShell] Error shutting down service "${name}":`, err);
      }
    }
  }

  private log(message: string): void {
    if (this.config.debug) {
      console.log(`[AppShell] ${message}`);
    }
  }
}

// ── Exports ────────────────────────────────────────────────────────────────────

export { AppShell, BrowserWindow, WindowLifecycleError, DEFAULT_CONFIG };
export type { IAppShell, IWindow, ISharedService, AppConfig };