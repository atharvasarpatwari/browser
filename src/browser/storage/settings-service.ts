import type { IDisposable } from '../../app/dependency-container';
import type { ISettingsStore } from './settings-store';
import type { ISettingsPage, SettingsPageEvent } from '../../ui/pages/settings-page';

type SettingsChangeHandler = (key: string, value: unknown, oldValue: unknown) => void;

interface ISettingsService extends IDisposable {
  init(settingsPage: ISettingsPage): void;
  getValue<T = unknown>(key: string): T | undefined;
  setValue(key: string, value: unknown): void;
  getBoolean(key: string, fallback?: boolean): boolean;
  getString(key: string, fallback?: string): string;
  getNumber(key: string, fallback?: number): number;
  has(key: string): boolean;
  onChange(handler: SettingsChangeHandler): void;
  offChange(handler: SettingsChangeHandler): void;
  resetAll(): void;
  dispose(): void;
}

class SettingsService implements ISettingsService {
  private readonly store: ISettingsStore;
  private page: ISettingsPage | null = null;
  private readonly listeners: SettingsChangeHandler[] = [];
  private syncing = false;

  constructor(store: ISettingsStore) {
    this.store = store;
  }

  init(settingsPage: ISettingsPage): void {
    this.page = settingsPage;

    settingsPage.on('settingChanged', (event: SettingsPageEvent) => {
      if (this.syncing) return;
      if (event.key === undefined) return;
      this.store.set(event.key, event.value);
    });

    for (const [key, value] of this.store.entries()) {
      this.syncing = true;
      settingsPage.setSetting(key, value);
      this.syncing = false;
    }
  }

  getValue<T = unknown>(key: string): T | undefined {
    if (this.page) {
      return this.page.getSetting(key) as T | undefined;
    }
    return this.store.get(key) as T | undefined;
  }

  setValue(key: string, value: unknown): void {
    const oldValue = this.getValue(key);
    if (this.page) {
      this.syncing = true;
      this.page.setSetting(key, value);
      this.syncing = false;
    }
    this.store.set(key, value);
    this.emitChange(key, value, oldValue);
  }

  getBoolean(key: string, fallback = false): boolean {
    const v = this.getValue(key);
    return typeof v === 'boolean' ? v : fallback;
  }

  getString(key: string, fallback = ''): string {
    const v = this.getValue(key);
    return typeof v === 'string' ? v : fallback;
  }

  getNumber(key: string, fallback = 0): number {
    const v = this.getValue(key);
    return typeof v === 'number' ? v : fallback;
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  onChange(handler: SettingsChangeHandler): void {
    this.listeners.push(handler);
  }

  offChange(handler: SettingsChangeHandler): void {
    const idx = this.listeners.indexOf(handler);
    if (idx !== -1) this.listeners.splice(idx, 1);
  }

  resetAll(): void {
    this.store.reset();
    if (this.page) {
      this.syncing = true;
      this.page.resetToDefaults();
      this.syncing = false;
    }
    for (const [key, value] of this.store.entries()) {
      this.emitChange(key, value, undefined);
    }
  }

  dispose(): void {
    this.page?.off('settingChanged', () => {});
    this.page = null;
    this.listeners.length = 0;
    this.store.dispose();
  }

  private emitChange(key: string, value: unknown, oldValue: unknown): void {
    for (const handler of this.listeners) {
      try {
        handler(key, value, oldValue);
      } catch (err) {
        console.error('[SettingsService] Listener error:', err);
      }
    }
  }
}

export { SettingsService };
export type { ISettingsService, SettingsChangeHandler };
