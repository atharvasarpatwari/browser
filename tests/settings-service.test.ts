import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsStore } from '../src/browser/storage/settings-store';
import { SettingsService } from '../src/browser/storage/settings-service';
import type { ISettingsPage, SettingsPageEvent } from '../src/ui/pages/settings-page';

function createMockPage(): ISettingsPage & { _values: Map<string, unknown>; _handlers: Array<(e: SettingsPageEvent) => void> } {
  const values = new Map<string, unknown>();
  const handlers: Array<(e: SettingsPageEvent) => void> = [];

  const page: ISettingsPage & { _values: typeof values; _handlers: typeof handlers } = {
    _values: values,
    _handlers: handlers,
    isMounted: false,
    sections: [],
    mount: vi.fn(),
    unmount: vi.fn(),
    getSetting: (key: string) => values.get(key),
    setSetting: (key: string, value: unknown) => {
      values.set(key, value);
      for (const h of handlers) {
        h({ kind: 'settingChanged', key, value });
      }
    },
    resetToDefaults: () => {
      values.clear();
    },
    getActiveSection: () => 'general',
    setActiveSection: vi.fn(),
    on: (_type: string, handler: (e: SettingsPageEvent) => void) => {
      handlers.push(handler);
    },
    off: (_type: string, handler: (e: SettingsPageEvent) => void) => {
      const idx = handlers.indexOf(handler);
      if (idx !== -1) handlers.splice(idx, 1);
    },
    dispose: vi.fn(),
  };

  return page;
}

describe('SettingsService', () => {
  let store: SettingsStore;
  let service: SettingsService;

  beforeEach(() => {
    store = new SettingsStore();
    service = new SettingsService(store);
  });

  it('should be constructable', () => {
    expect(service).toBeDefined();
  });

  it('getValue should return undefined when not initialized', () => {
    expect(service.getValue('theme')).toBeUndefined();
  });

  it('setValue should persist to store', () => {
    service.setValue('theme', 'dark');
    expect(store.get('theme')).toBe('dark');
  });

  it('setValue should emit change event', () => {
    const handler = vi.fn();
    service.onChange(handler);
    service.setValue('theme', 'dark');
    expect(handler).toHaveBeenCalledWith('theme', 'dark', undefined);
  });

  it('setValue should pass oldValue in change event', () => {
    service.setValue('theme', 'dark');
    const handler = vi.fn();
    service.onChange(handler);
    service.setValue('theme', 'light');
    expect(handler).toHaveBeenCalledWith('theme', 'light', 'dark');
  });

  it('offChange should remove listener', () => {
    const handler = vi.fn();
    service.onChange(handler);
    service.offChange(handler);
    service.setValue('theme', 'dark');
    expect(handler).not.toHaveBeenCalled();
  });

  it('getBoolean should return fallback for non-boolean values', () => {
    expect(service.getBoolean('missing')).toBe(false);
    expect(service.getBoolean('missing', true)).toBe(true);
    service.setValue('flag', true);
    expect(service.getBoolean('flag')).toBe(true);
  });

  it('getString should return fallback for non-string values', () => {
    expect(service.getString('missing')).toBe('');
    expect(service.getString('missing', 'default')).toBe('default');
    service.setValue('name', 'test');
    expect(service.getString('name')).toBe('test');
  });

  it('getNumber should return fallback for non-number values', () => {
    expect(service.getNumber('missing')).toBe(0);
    expect(service.getNumber('missing', 42)).toBe(42);
    service.setValue('count', 10);
    expect(service.getNumber('count')).toBe(10);
  });

  it('has should check store existence', () => {
    expect(service.has('theme')).toBe(false);
    service.setValue('theme', 'dark');
    expect(service.has('theme')).toBe(true);
  });

  it('init should load persisted values into page', () => {
    store.set('theme', 'light');
    store.set('fontSize', 14);

    const page = createMockPage();
    service.init(page);

    expect(page._values.get('theme')).toBe('light');
    expect(page._values.get('fontSize')).toBe(14);
  });

  it('init should sync page changes back to store', () => {
    const page = createMockPage();
    service.init(page);

    page.setSetting('theme', 'dark');
    expect(store.get('theme')).toBe('dark');
  });

  it('init should not create infinite loop (sync flag)', () => {
    store.set('theme', 'light');
    const page = createMockPage();
    const spy = vi.fn();
    service.onChange(spy);

    service.init(page);

    // Setting during init should not trigger service change listeners
    expect(spy).not.toHaveBeenCalled();
  });

  it('getValue should read from page after init', () => {
    const page = createMockPage();
    page._values.set('theme', 'blue');
    service.init(page);
    expect(service.getValue('theme')).toBe('blue');
  });

  it('setValue should update page when initialized', () => {
    const page = createMockPage();
    service.init(page);
    service.setValue('theme', 'green');
    expect(page._values.get('theme')).toBe('green');
  });

  it('resetAll should clear store and page', () => {
    store.set('theme', 'dark');
    const page = createMockPage();
    service.init(page);

    service.resetAll();
    expect(store.size).toBe(0);
    expect(page._values.size).toBe(0);
  });

  it('dispose should clean up', () => {
    const page = createMockPage();
    service.init(page);
    service.dispose();
    // Should not throw after dispose
  });

  it('should handle multiple listeners', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    service.onChange(h1);
    service.onChange(h2);
    service.setValue('a', 1);
    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it('should handle listener errors gracefully', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const badHandler = () => { throw new Error('bad'); };
    const goodHandler = vi.fn();
    service.onChange(badHandler);
    service.onChange(goodHandler);

    service.setValue('a', 1);
    expect(consoleSpy).toHaveBeenCalled();
    expect(goodHandler).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('init should not duplicate page setSetting events during load', () => {
    store.set('theme', 'light');
    const page = createMockPage();
    const pageHandler = vi.fn();
    page.on('settingChanged', pageHandler);

    service.init(page);

    // init calls page.setSetting for each stored value, which triggers page handlers
    // but the sync flag prevents re-entering the service
    expect(pageHandler).toHaveBeenCalledWith({ kind: 'settingChanged', key: 'theme', value: 'light' });
  });
});
