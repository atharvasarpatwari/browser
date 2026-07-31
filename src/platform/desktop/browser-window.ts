/**
 * @file browser-window.ts
 * @layer Platform — Desktop
 *
 * The desktop OS window abstraction. Owned by the platform layer so that
 * desktop windowing code (WindowManager) does not depend upward on the app
 * shell (breaks the app <-> platform cycle).
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

/**
 * Wraps the actual OS / Electron window.
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

export { BrowserWindow };
export type { IWindow };
