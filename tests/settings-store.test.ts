import { describe, it, expect, beforeEach } from 'vitest';
import { SettingsStore, STORAGE_KEY } from '../src/browser/storage/settings-store';

class MockStorage implements Storage {
  private data = new Map<string, string>();

  get length(): number { return this.data.size; }

  clear(): void { this.data.clear(); }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe('SettingsStore', () => {
  let store: SettingsStore;
  let storage: MockStorage;

  beforeEach(() => {
    storage = new MockStorage();
    store = new SettingsStore(storage);
  });

  it('should initialize empty', () => {
    expect(store.size).toBe(0);
    expect(store.keys()).toHaveLength(0);
  });

  it('should set and get a value', () => {
    store.set('theme', 'dark');
    expect(store.get('theme')).toBe('dark');
    expect(store.size).toBe(1);
  });

  it('should return undefined for missing key', () => {
    expect(store.get('nonexistent')).toBeUndefined();
  });

  it('should check key existence', () => {
    expect(store.has('theme')).toBe(false);
    store.set('theme', 'dark');
    expect(store.has('theme')).toBe(true);
  });

  it('should delete a key', () => {
    store.set('theme', 'dark');
    store.delete('theme');
    expect(store.has('theme')).toBe(false);
    expect(store.size).toBe(0);
  });

  it('should clear all entries', () => {
    store.set('a', 1);
    store.set('b', 2);
    store.clear();
    expect(store.size).toBe(0);
  });

  it('should return all keys', () => {
    store.set('a', 1);
    store.set('b', 2);
    expect(store.keys()).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('should return all entries', () => {
    store.set('a', 1);
    store.set('b', 2);
    const entries = store.entries();
    expect(entries).toHaveLength(2);
    expect(entries).toEqual(expect.arrayContaining([['a', 1], ['b', 2]]));
  });

  it('should persist to storage on set', () => {
    store.set('theme', 'dark');
    const raw = storage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.theme).toBe('dark');
  });

  it('should persist on delete', () => {
    store.set('a', 1);
    store.set('b', 2);
    store.delete('a');
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY)!);
    expect(parsed.a).toBeUndefined();
    expect(parsed.b).toBe(2);
  });

  it('should persist on clear', () => {
    store.set('a', 1);
    store.clear();
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY)!);
    expect(Object.keys(parsed)).toHaveLength(0);
  });

  it('should load from storage on construction', () => {
    storage.setItem(STORAGE_KEY, JSON.stringify({ theme: 'light', fontSize: 14 }));
    const store2 = new SettingsStore(storage);
    expect(store2.get('theme')).toBe('light');
    expect(store2.get('fontSize')).toBe(14);
    expect(store2.size).toBe(2);
  });

  it('should handle corrupted storage gracefully', () => {
    storage.setItem(STORAGE_KEY, 'NOT JSON{{{');
    const store2 = new SettingsStore(storage);
    expect(store2.size).toBe(0);
  });

  it('should handle missing storage key', () => {
    const store2 = new SettingsStore(storage);
    expect(store2.size).toBe(0);
  });

  it('should work without storage (in-memory only)', () => {
    const store2 = new SettingsStore();
    store2.set('key', 'value');
    expect(store2.get('key')).toBe('value');
  });

  it('should reset to empty', () => {
    store.set('a', 1);
    store.set('b', 2);
    store.reset();
    expect(store.size).toBe(0);
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY)!);
    expect(Object.keys(parsed)).toHaveLength(0);
  });

  it('should overwrite existing values', () => {
    store.set('theme', 'dark');
    store.set('theme', 'light');
    expect(store.get('theme')).toBe('light');
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY)!);
    expect(parsed.theme).toBe('light');
  });

  it('should dispose cleanly', () => {
    store.set('a', 1);
    store.dispose();
    expect(store.size).toBe(0);
  });

  it('should handle various value types', () => {
    store.set('string', 'hello');
    store.set('number', 42);
    store.set('boolean', true);
    store.set('null', null);
    store.set('object', { nested: true });
    store.set('array', [1, 2, 3]);

    expect(store.get('string')).toBe('hello');
    expect(store.get('number')).toBe(42);
    expect(store.get('boolean')).toBe(true);
    expect(store.get('null')).toBeNull();
    expect(store.get('object')).toEqual({ nested: true });
    expect(store.get('array')).toEqual([1, 2, 3]);
  });
});
