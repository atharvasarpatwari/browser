import type { IDisposable } from '../../app/dependency-container';
import type { ISettingsService } from '../storage/settings-service';

const BROWSER_NAME_KEY = 'browserName';
const DEFAULT_NAME = 'Nova Browser';

interface IBrowserName extends IDisposable {
  /** Initialize from settings service. Call once during bootstrap. */
  init(settingsService: ISettingsService): void;
  /** Current browser name (e.g. "Nova Browser"). */
  readonly name: string;
  /** Get the full window title, e.g. "Nova Browser v1.0.0". */
  getTitle(version?: string): string;
  /** Get the user-agent product token, e.g. "NovaBrowser/1.0.0". */
  getUserAgent(version?: string): string;
  /** Get the brand string for search results / about pages. */
  getBrand(): string;
  /** Get the HTML logo fragment for the new-tab page. */
  getLogoHtml(): string;
  /** Set a new name (persists to settings). */
  setName(name: string): void;
  /** Subscribe to name changes. */
  onNameChanged(handler: (name: string) => void): void;
  /** Unsubscribe. */
  offNameChanged(handler: (name: string) => void): void;
}

class BrowserName implements IBrowserName {
  private _name = DEFAULT_NAME;
  private readonly listeners: Array<(name: string) => void> = [];
  private settingsService: ISettingsService | null = null;
  private changeHandler: ((key: string, value: unknown) => void) | null = null;

  constructor() {}

  get name(): string { return this._name; }

  /** Bind to settings. Call once during bootstrap. */
  init(settingsService: ISettingsService): void {
    this.settingsService = settingsService;

    const saved = settingsService.getString(BROWSER_NAME_KEY, DEFAULT_NAME);
    if (saved && saved !== this._name) {
      this._name = saved;
    }

    this.changeHandler = (key: string, value: unknown) => {
      if (key === BROWSER_NAME_KEY && typeof value === 'string' && value !== this._name) {
        this._name = value;
        this.emitChange();
      }
    };
    settingsService.onChange(this.changeHandler);
  }

  getTitle(version?: string): string {
    return version ? `${this._name} v${version}` : this._name;
  }

  getUserAgent(version?: string): string {
    const product = this._name.replace(/\s+/g, '');
    return version ? `${product}/${version}` : `${product}/1.0`;
  }

  getBrand(): string {
    return this._name;
  }

  getLogoHtml(): string {
    const parts = this._name.split(' ');
    if (parts.length <= 1) {
      return `<span>${this._name}</span>`;
    }
    return `${parts[0]}<span>${parts.slice(1).join(' ')}</span>`;
  }

  setName(name: string): void {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed === this._name) return;
    this._name = trimmed;
    if (this.settingsService) {
      this.settingsService.setValue(BROWSER_NAME_KEY, trimmed);
    }
    this.emitChange();
  }

  onNameChanged(handler: (name: string) => void): void {
    this.listeners.push(handler);
  }

  offNameChanged(handler: (name: string) => void): void {
    const idx = this.listeners.indexOf(handler);
    if (idx !== -1) this.listeners.splice(idx, 1);
  }

  private emitChange(): void {
    for (const h of this.listeners) {
      try { h(this._name); } catch (err) {
        console.error('[BrowserName] Listener error:', err);
      }
    }
  }

  dispose(): void {
    if (this.settingsService && this.changeHandler) {
      this.settingsService.offChange(this.changeHandler);
      this.changeHandler = null;
    }
    this.listeners.length = 0;
  }
}

export { BrowserName, DEFAULT_NAME, BROWSER_NAME_KEY };
export type { IBrowserName };
